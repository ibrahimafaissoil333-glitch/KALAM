import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AppConfig, CONFIG } from '../config.js';
import { AuditService } from '../common/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { orderReference } from '../common/util.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PAYMENT_PROVIDER, PaymentProvider, WebhookEvent } from '../payments/provider.js';

export type OrderView = ReturnType<OrdersService["view"]>;

const orderInclude = { items: true, payments: { orderBy: { createdAt: 'desc' as const } } };

/**
 * Cycle de vie d'une commande. Règle absolue : un droit d'accès n'est créé
 * que dans `applyWebhook`, après vérification de la signature du prestataire.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger('Orders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async create(userId: string, opts: { ebookIds?: string[]; idempotencyKey?: string; platform?: string; returnUrl?: string }): Promise<{ order: OrderView; checkoutUrl: string | null }> {
    if (opts.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: opts.idempotencyKey } },
        include: orderInclude,
      });
      if (existing) return this.withCheckout(existing);
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    let ebookIds = opts.ebookIds;
    if (!ebookIds?.length) {
      const cart = await this.prisma.cart.findUnique({ where: { userId }, include: { items: true } });
      ebookIds = cart?.items.map((i) => i.ebookId) ?? [];
    }
    ebookIds = [...new Set(ebookIds)];
    if (!ebookIds.length) throw new BadRequestException('Votre panier est vide.');

    const ebooks = await this.prisma.ebook.findMany({ where: { id: { in: ebookIds }, status: 'PUBLISHED', priceCents: { not: null } } });
    if (ebooks.length !== ebookIds.length) throw new ConflictException("Un e-book de votre panier n'est plus disponible.");
    const owned = await this.prisma.entitlement.findFirst({ where: { userId, ebookId: { in: ebookIds }, revokedAt: null }, include: { ebook: true } });
    if (owned) throw new ConflictException(`« ${owned.ebook.title} » est déjà dans votre bibliothèque.`);
    const currencies = new Set(ebooks.map((e) => e.currency));
    if (currencies.size > 1) throw new BadRequestException('Les e-books du panier doivent avoir la même devise.');

    const totalCents = ebooks.reduce((n, e) => n + e.priceCents!, 0);
    let order;
    try {
      order = await this.prisma.order.create({
        data: {
          reference: orderReference(),
          userId,
          totalCents,
          currency: ebooks[0].currency,
          idempotencyKey: opts.idempotencyKey,
          platform: opts.platform,
          items: { create: ebooks.map((e) => ({ ebookId: e.id, title: e.title, priceCents: e.priceCents! })) },
        },
        include: orderInclude,
      });
    } catch (err) {
      // Deux requêtes simultanées avec la même clé : on renvoie la commande gagnante.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && opts.idempotencyKey) {
        return this.create(userId, opts);
      }
      throw err;
    }
    const returnUrl = opts.returnUrl && this.cfg.payment.returnPrefixes.some((p) => opts.returnUrl!.startsWith(p)) ? opts.returnUrl : this.cfg.payment.returnUrl;
    const session = await this.provider.createSession({
      orderId: order.id,
      reference: order.reference,
      customerEmail: user.email ?? '',
      currency: order.currency,
      totalCents,
      items: order.items.map((i) => ({ title: i.title, priceCents: i.priceCents })),
      returnUrl,
    });
    await this.prisma.payment.create({
      data: { orderId: order.id, provider: this.provider.name, providerSessionId: session.sessionId, amountCents: totalCents, currency: order.currency, returnUrl },
    });
    return { order: this.view(order), checkoutUrl: session.url };
  }

  private async withCheckout(order: Prisma.OrderGetPayload<{ include: typeof orderInclude }>) {
    const pay = order.payments[0];
    const checkoutUrl = order.status === 'PENDING' && pay && this.provider.name === 'fake'
      ? `${this.cfg.publicApiUrl}/v1/fake-checkout/${pay.providerSessionId}`
      : null;
    return { order: this.view(order), checkoutUrl };
  }

  view(o: Prisma.OrderGetPayload<{ include: { items: true } }>) {
    return {
      id: o.id,
      reference: o.reference,
      status: o.status,
      totalCents: o.totalCents,
      currency: o.currency,
      taxCents: o.taxCents,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      items: o.items.map((i) => ({ ebookId: i.ebookId, title: i.title, priceCents: i.priceCents })),
    };
  }

  async listForUser(userId: string) {
    const rows = await this.prisma.order.findMany({ where: { userId }, include: { items: true }, orderBy: { createdAt: 'desc' } });
    return rows.map((o) => this.view(o));
  }

  /** Toujours filtré par propriétaire : un autre compte reçoit 404 (pas d'IDOR). */
  async getForUser(userId: string, id: string) {
    const o = await this.prisma.order.findFirst({ where: { id, userId }, include: { items: true } });
    if (!o) throw new NotFoundException('Commande introuvable.');
    return this.view(o);
  }

  /**
   * Traite un événement déjà authentifié. Idempotent : l'identifiant d'événement est unique,
   * et chaque transition est conditionnée au statut attendu.
   */
  async applyWebhook(ev: WebhookEvent): Promise<'applied' | 'duplicate' | 'ignored'> {
    try {
      await this.prisma.paymentEvent.create({
        data: { provider: this.provider.name, providerEventId: ev.eventId, type: ev.type, outcome: ev.outcome },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate';
      throw err;
    }
    if (ev.outcome === 'ignored') return 'ignored';

    const payment = ev.sessionId
      ? await this.prisma.payment.findUnique({ where: { providerSessionId: ev.sessionId }, include: { order: { include: { items: true, user: true } } } })
      : ev.paymentId
        ? await this.prisma.payment.findFirst({ where: { providerPaymentId: ev.paymentId }, include: { order: { include: { items: true, user: true } } } })
        : null;
    if (!payment) {
      this.logger.warn(`Webhook ${ev.eventId} : paiement inconnu`);
      return 'ignored';
    }
    await this.prisma.paymentEvent.updateMany({ where: { provider: this.provider.name, providerEventId: ev.eventId }, data: { orderId: payment.orderId } });
    const order = payment.order;

    if (ev.outcome === 'succeeded') {
      const applied = await this.prisma.$transaction(async (tx) => {
        // Un paiement confirmé après une annulation automatique reste valable : l'argent a été encaissé.
        const { count } = await tx.order.updateMany({
          where: { id: order.id, status: { in: ['PENDING', 'CANCELED', 'FAILED'] } },
          data: { status: 'PAID', paidAt: new Date(), taxCents: ev.taxCents, taxCountry: ev.taxCountry },
        });
        if (count === 0) return false;
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', providerPaymentId: ev.paymentId ?? payment.providerPaymentId } });
        for (const item of order.items) {
          await tx.entitlement.upsert({
            where: { userId_ebookId: { userId: order.userId, ebookId: item.ebookId } },
            create: { userId: order.userId, ebookId: item.ebookId, orderId: order.id },
            update: { revokedAt: null, orderId: order.id, grantedAt: new Date() },
          });
        }
        const cart = await tx.cart.findUnique({ where: { userId: order.userId } });
        if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id, ebookId: { in: order.items.map((i) => i.ebookId) } } });
        return true;
      });
      if (!applied) return 'ignored';
      if (order.user.email) this.mail.orderConfirmed(order.user.email, order.reference, order.items.map((i) => i.title), order.totalCents, order.currency);
      return 'applied';
    }

    if (ev.outcome === 'failed') {
      const { count } = await this.prisma.order.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'FAILED', failedAt: new Date() } });
      if (count === 0) return 'ignored';
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: ev.reason } });
      if (order.user.email) this.mail.paymentFailed(order.user.email, order.reference);
      return 'applied';
    }

    // Remboursement signalé par le prestataire (ex. fait depuis son tableau de bord).
    return (await this.markRefunded(order.id, null)) ? 'applied' : 'ignored';
  }

  /** Remboursement à l'initiative de l'admin : appel au prestataire, puis effet immédiat. */
  async refund(orderId: string, adminId: string, ip?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
    if (!order) throw new NotFoundException('Commande introuvable.');
    if (order.status !== 'PAID') throw new ConflictException('Seule une commande confirmée peut être remboursée.');
    const pay = order.payments.find((p) => p.status === 'SUCCEEDED');
    if (pay?.providerPaymentId) await this.provider.refund(pay.providerPaymentId);
    await this.markRefunded(orderId, adminId, ip);
  }

  private async markRefunded(orderId: string, actorId: string | null, ip?: string): Promise<boolean> {
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: 'PAID' }, data: { status: 'REFUNDED', refundedAt: new Date() } });
      if (count === 0) return false;
      await tx.payment.updateMany({ where: { orderId, status: 'SUCCEEDED' }, data: { status: 'REFUNDED' } });
      // Règle D11 : l'accès est retiré au remboursement.
      await tx.entitlement.updateMany({ where: { orderId, revokedAt: null }, data: { revokedAt: new Date() } });
      return true;
    });
    if (!done) return false;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { user: true } });
    await this.audit.log({ actorId, action: 'order.refund', targetType: 'order', targetId: orderId, meta: { reference: order.reference }, ip });
    if (order.user.email) this.mail.orderRefunded(order.user.email, order.reference);
    return true;
  }

  /** Commandes abandonnées : PENDING sans webhook au-delà du délai configuré → CANCELED. */
  @Interval(5 * 60_000)
  async cancelStale() {
    const limit = new Date(Date.now() - this.cfg.payment.pendingTtlMinutes * 60_000);
    const { count } = await this.prisma.order.updateMany({ where: { status: 'PENDING', createdAt: { lt: limit } }, data: { status: 'CANCELED', canceledAt: new Date() } });
    if (count) this.logger.log(`${count} commande(s) en attente annulée(s)`);
    return count;
  }
}
