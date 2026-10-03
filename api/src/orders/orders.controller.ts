import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiHeader, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppConfig, CONFIG } from '../config.js';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import { FakePaymentProvider } from '../payments/fake.provider.js';
import { InvalidSignatureError, PAYMENT_PROVIDER, PaymentProvider } from '../payments/provider.js';
import { OrdersService } from './orders.service.js';

class CreateOrderDto {
  @ApiPropertyOptional({ type: [String], description: 'Par défaut : le contenu du panier' })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true })
  ebookIds?: string[];

  @ApiPropertyOptional({ enum: ['ios', 'android', 'web'] })
  @IsOptional() @IsIn(['ios', 'android', 'web'])
  platform?: string;

  @ApiPropertyOptional({ description: "Adresse de retour de l'app après paiement (préfixes autorisés : CHECKOUT_RETURN_PREFIXES)" })
  @IsOptional() @IsString() @MaxLength(300)
  returnUrl?: string;
}

@ApiTags('Commandes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Créer une commande PENDING et une session de paiement' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Évite une double commande en cas de double clic' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto, @Headers('idempotency-key') key?: string) {
    if (key && key.length > 100) throw new BadRequestException('Idempotency-Key trop longue.');
    return this.orders.create(user.id, { ebookIds: dto.ebookIds, idempotencyKey: key, platform: dto.platform, returnUrl: dto.returnUrl });
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.orders.listForUser(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: "Statut d'une commande (interrogé par l'app après le retour de paiement)" })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForUser(user.id, id);
  }
}

@ApiTags('Webhooks')
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger('Webhook');

  constructor(
    private readonly orders: OrdersService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Post('payment')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook du prestataire. Signature vérifiée ; seule source de confirmation de paiement.' })
  async payment(@Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) throw new BadRequestException('Corps manquant.');
    let event;
    try {
      event = await this.provider.parseWebhook(req.rawBody, req.headers);
    } catch (err) {
      if (err instanceof InvalidSignatureError) {
        this.logger.warn(`Webhook rejeté : ${err.message}`);
        throw new BadRequestException('Signature invalide.');
      }
      throw err;
    }
    const result = await this.orders.applyWebhook(event);
    return { received: true, result };
  }
}

/** Page de paiement simulée (développement uniquement), qui envoie un vrai webhook signé. */
@ApiExcludeController()
@SkipThrottle()
@Controller('fake-checkout')
export class FakeCheckoutController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  private async session(id: string) {
    if (!(this.provider instanceof FakePaymentProvider) || this.cfg.isProd) throw new NotFoundException();
    const pay = await this.prisma.payment.findUnique({ where: { providerSessionId: id }, include: { order: { include: { items: true } } } });
    if (!pay) throw new NotFoundException();
    return { pay, provider: this.provider };
  }

  @Get(':sessionId')
  async page(@Param('sessionId') id: string, @Res() res: Response) {
    const { pay } = await this.session(id);
    const fmt = (c: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: pay.currency }).format(c / 100);
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const lines = pay.order.items.map((i) => `<li><span>${esc(i.title)}</span><b>${fmt(i.priceCents)}</b></li>`).join('');
    const done = pay.order.status !== 'PENDING';
    res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paiement de test</title><style>
body{margin:0;font-family:system-ui,sans-serif;background:#FAFAF7;color:#14151F;display:flex;justify-content:center}
main{max-width:420px;width:100%;padding:32px 20px;display:flex;flex-direction:column;gap:16px}
.warn{background:#FFF0D2;color:#7A4E00;border-radius:12px;padding:12px 14px;font-size:14px;font-weight:600}
ul{list-style:none;padding:0;margin:0;background:#fff;border:1px solid #E6E5E0;border-radius:16px}
li{display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #ECEBE6}
.total{font-weight:700;font-size:18px;display:flex;justify-content:space-between}
button{min-height:52px;border-radius:14px;border:0;font-size:16px;font-weight:600;cursor:pointer;width:100%}
.ok{background:#3B36E0;color:#fff}.ko{background:transparent;border:1.5px solid #D6D5CF;color:#14151F}
</style></head><body><main>
<div class="warn">Prestataire de test : aucun paiement réel n'est effectué.</div>
<h1 style="margin:0;font-size:26px">Commande ${esc(pay.order.reference)}</h1>
<ul>${lines}</ul><div class="total"><span>Total</span><span>${fmt(pay.amountCents)}</span></div>
${done ? `<p>Cette commande est déjà traitée (${pay.order.status}).</p>` : `
<form method="post" action="/v1/fake-checkout/${esc(id)}/complete?outcome=succeeded"><button class="ok">Payer ${fmt(pay.amountCents)}</button></form>
<form method="post" action="/v1/fake-checkout/${esc(id)}/complete?outcome=failed"><button class="ko">Simuler un refus de carte</button></form>
<form method="post" action="/v1/fake-checkout/${esc(id)}/complete?outcome=abandon"><button class="ko">Fermer sans payer</button></form>`}
</main></body></html>`);
  }

  @Post(':sessionId/complete')
  async complete(@Param('sessionId') id: string, @Req() req: Request, @Res() res: Response) {
    const { pay, provider } = await this.session(id);
    const outcome = String(req.query.outcome);
    if (outcome === 'succeeded' || outcome === 'failed') {
      const body = JSON.stringify({
        id: `evt_${randomUUID()}`,
        type: outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
        sessionId: id,
        paymentId: outcome === 'succeeded' ? `fake_pi_${randomUUID()}` : undefined,
        reason: outcome === 'failed' ? 'card_declined' : undefined,
      });
      // Le webhook est envoyé à l'API par HTTP, exactement comme le ferait un vrai prestataire.
      await fetch(`${this.cfg.publicApiUrl}/v1/webhooks/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fake-signature': provider.sign(body) },
        body,
      });
    }
    const returnUrl = pay.returnUrl ?? this.cfg.payment.returnUrl;
    const sep = returnUrl.includes('?') ? '&' : '?';
    res.redirect(303, `${returnUrl}${sep}order=${pay.orderId}&result=${outcome === 'abandon' ? 'cancel' : 'success'}`);
  }
}

