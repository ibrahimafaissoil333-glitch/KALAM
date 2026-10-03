import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app.factory.js';
import { PrismaService } from '../common/prisma.service.js';
import { normalize } from '../common/util.js';
import { buildEpub } from '../epub/build-epub.js';
import { parseEpub } from '../epub/epub.js';
import { MailService } from '../mail/mail.service.js';
import { FakePaymentProvider } from '../payments/fake.provider.js';
import { PAYMENT_PROVIDER } from '../payments/provider.js';
import { StorageService } from '../storage/storage.service.js';

export const PASSWORD = 'motdepasse1';

export class TestEnv {
  app!: INestApplication;
  prisma!: PrismaService;
  mail!: MailService;
  storage!: StorageService;
  provider!: FakePaymentProvider;

  static async start() {
    const env = new TestEnv();
    env.app = await createApp({ logger: false });
    await env.app.init();
    env.prisma = env.app.get(PrismaService);
    env.mail = env.app.get(MailService);
    env.storage = env.app.get(StorageService);
    env.provider = env.app.get(PAYMENT_PROVIDER);
    await env.reset();
    return env;
  }

  get http() {
    return request(this.app.getHttpServer());
  }

  async reset() {
    await this.prisma.$executeRawUnsafe(`
      TRUNCATE users, refresh_tokens, password_resets, devices, categories, ebooks, files, carts, cart_items,
        orders, order_items, payments, payment_events, entitlements, download_events, reading_progress,
        notification_prefs, audit_logs, ebook_views, settings CASCADE`);
    this.mail.outbox.length = 0;
  }

  async stop() {
    await this.app.close();
  }

  async register(name = 'Sarah', email = `u-${randomUUID()}@test.fr`) {
    const res = await this.http.post('/v1/auth/register').send({ name, email, password: PASSWORD, acceptTerms: true }).expect(201);
    return { token: res.body.accessToken as string, refresh: res.body.refreshToken as string, id: res.body.user.id as string, email };
  }

  async admin() {
    const u = await this.register('Admin', `admin-${randomUUID()}@test.fr`);
    await this.prisma.user.update({ where: { id: u.id }, data: { role: 'ADMIN' } });
    return u;
  }

  /** Crée un e-book publié avec un contenu lisible. */
  async ebook(title = 'Les Nuits de Tanger', opts: { priceCents?: number; downloadAllowed?: boolean; status?: 'DRAFT' | 'PUBLISHED' } = {}) {
    const category = await this.prisma.category.upsert({ where: { name: 'Roman' }, create: { name: 'Roman', slug: 'roman' }, update: {} });
    const e = await this.prisma.ebook.create({
      data: {
        slug: `${normalize(title).replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`,
        title,
        author: 'Yanis Okafor',
        description: 'Description',
        categoryId: category.id,
        priceCents: opts.priceCents ?? 1299,
        status: opts.status ?? 'PUBLISHED',
        publishedAt: new Date(),
        downloadAllowed: opts.downloadAllowed ?? true,
        searchText: normalize(`${title} Yanis Okafor Roman`),
      },
    });
    const epub = await buildEpub({ title, author: 'Yanis Okafor', chapters: [{ title: 'Un', paragraphs: Array.from({ length: 20 }, (_, i) => `Paragraphe ${i + 1}`) }] });
    const mainKey = StorageService.keyFor(e.id, 'MAIN', 'epub');
    const contentKey = StorageService.keyFor(e.id, 'CONTENT', 'json');
    await this.storage.put(mainKey, epub, 'application/epub+zip');
    await this.storage.put(contentKey, Buffer.from(JSON.stringify(parseEpub(epub))), 'application/json');
    await this.prisma.file.createMany({
      data: [
        { ebookId: e.id, kind: 'MAIN', storageKey: mainKey, mimeType: 'application/epub+zip', sizeBytes: epub.length },
        { ebookId: e.id, kind: 'CONTENT', storageKey: contentKey, mimeType: 'application/json', sizeBytes: 1 },
      ],
    });
    return e;
  }

  async order(token: string, ebookIds: string[]) {
    const res = await this.http.post('/v1/orders').set('Authorization', `Bearer ${token}`).send({ ebookIds }).expect(201);
    const pay = await this.prisma.payment.findFirstOrThrow({ where: { orderId: res.body.order.id } });
    return { orderId: res.body.order.id as string, sessionId: pay.providerSessionId, checkoutUrl: res.body.checkoutUrl as string };
  }

  /** Envoie un webhook signé comme le ferait le prestataire. */
  webhook(body: Record<string, unknown>, opts: { signature?: string } = {}) {
    const raw = JSON.stringify(body);
    return this.http
      .post('/v1/webhooks/payment')
      .set('content-type', 'application/json')
      .set('x-fake-signature', opts.signature ?? this.provider.sign(raw))
      .send(raw);
  }

  async pay(token: string, ebookIds: string[]) {
    const o = await this.order(token, ebookIds);
    await this.webhook({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', sessionId: o.sessionId, paymentId: `pi_${randomUUID()}` }).expect(200);
    return o;
  }
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
