import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { TestEnv, auth } from './helpers.js';

describe('Catalogue, panier, paiement et bibliothèque', () => {
  let env: TestEnv;
  before(async () => (env = await TestEnv.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  it('CA-01 / CA-02 / CA-04 : catalogue publié, recherche sans accents, tri', async () => {
    await env.ebook('Les Nuits de Tanger');
    await env.ebook('Été à Alger');
    await env.ebook('Brouillon', { status: 'DRAFT' });
    const all = await env.http.get('/v1/catalog/ebooks').expect(200);
    assert.equal(all.body.total, 2);
    const q = await env.http.get('/v1/catalog/ebooks?q=ete').expect(200);
    assert.deepEqual(q.body.items.map((e: { title: string }) => e.title), ['Été à Alger']);
    const sorted = await env.http.get('/v1/catalog/ebooks?sort=title').expect(200);
    assert.deepEqual(sorted.body.items.map((e: { title: string }) => e.title), ['Été à Alger', 'Les Nuits de Tanger']);
    const none = await env.http.get('/v1/catalog/ebooks?q=zzz').expect(200);
    assert.equal(none.body.total, 0);
  });

  it('CA-06 : extrait gratuit sans compte, limité aux premiers blocs', async () => {
    const e = await env.ebook();
    await env.prisma.ebook.update({ where: { id: e.id }, data: { previewBlocks: 3 } });
    const res = await env.http.get(`/v1/catalog/ebooks/${e.slug}/preview`).expect(200);
    const blocks = res.body.chapters.flatMap((c: { blocks: unknown[] }) => c.blocks);
    assert.equal(blocks.length, 3);
  });

  it('CA-13 : fusion du panier invité sans doublon', async () => {
    const [a, b, c] = [await env.ebook('A'), await env.ebook('B'), await env.ebook('C')];
    const u = await env.register();
    await env.http.post('/v1/cart/items').set(auth(u.token)).send({ ebookId: a.id }).expect(201);
    const merged = await env.http.post('/v1/cart/merge').set(auth(u.token)).send({ ebookIds: [a.id, b.id, c.id] }).expect(200);
    assert.equal(merged.body.count, 3);
    assert.equal(merged.body.totalCents, 3 * 1299);
  });

  it("CA-14 / CA-17 : le webhook confirme, active l'accès une seule fois", async () => {
    const e = await env.ebook();
    const u = await env.register();
    const o = await env.order(u.token, [e.id]);
    // Avant le webhook : rien dans la bibliothèque (CA-15).
    assert.equal((await env.http.get(`/v1/orders/${o.orderId}`).set(auth(u.token))).body.status, 'PENDING');
    assert.equal((await env.http.get('/v1/library').set(auth(u.token))).body.length, 0);
    await env.http.get(`/v1/library/${e.id}/content`).set(auth(u.token)).expect(403);

    const event = { id: `evt_${randomUUID()}`, type: 'payment.succeeded', sessionId: o.sessionId, paymentId: 'pi_1' };
    const first = await env.webhook(event).expect(200);
    const second = await env.webhook(event).expect(200);
    assert.equal(first.body.result, 'applied');
    assert.equal(second.body.result, 'duplicate');

    assert.equal((await env.http.get(`/v1/orders/${o.orderId}`).set(auth(u.token))).body.status, 'PAID');
    const lib = await env.http.get('/v1/library').set(auth(u.token)).expect(200);
    assert.equal(lib.body.length, 1);
    assert.equal(await env.prisma.entitlement.count(), 1);
    assert.equal(env.mail.outbox.filter((m) => m.kind === 'order_confirmed').length, 1);
    await env.http.get(`/v1/library/${e.id}/content`).set(auth(u.token)).expect(200);
  });

  it('CA-16 : échec de paiement, panier conservé, aucun accès', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await env.http.post('/v1/cart/items').set(auth(u.token)).send({ ebookId: e.id }).expect(201);
    const o = await env.order(u.token, []);
    await env.webhook({ id: `evt_${randomUUID()}`, type: 'payment.failed', sessionId: o.sessionId, reason: 'card_declined' }).expect(200);
    assert.equal((await env.http.get(`/v1/orders/${o.orderId}`).set(auth(u.token))).body.status, 'FAILED');
    assert.equal((await env.http.get('/v1/cart').set(auth(u.token))).body.count, 1);
    assert.equal(await env.prisma.entitlement.count(), 0);
  });

  it('CA-18 : un webhook à la signature invalide est rejeté sans effet', async () => {
    const e = await env.ebook();
    const u = await env.register();
    const o = await env.order(u.token, [e.id]);
    const body = { id: 'evt_forge', type: 'payment.succeeded', sessionId: o.sessionId };
    await env.webhook(body, { signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` }).expect(400);
    await env.webhook(body, { signature: env.provider.sign(JSON.stringify(body), Math.floor(Date.now() / 1000) - 3600) }).expect(400);
    await env.http.post('/v1/webhooks/payment').send(body).expect(400);
    assert.equal(await env.prisma.entitlement.count(), 0);
  });

  it('Idempotency-Key : un double clic ne crée qu’une commande', async () => {
    const e = await env.ebook();
    const u = await env.register();
    const send = () => env.http.post('/v1/orders').set(auth(u.token)).set('Idempotency-Key', 'clic-1').send({ ebookIds: [e.id] }).expect(201);
    const [a, b] = await Promise.all([send(), send()]);
    assert.equal(a.body.order.id, b.body.order.id);
    assert.equal(await env.prisma.order.count(), 1);
  });

  it("n'accepte que les adresses de retour autorisées (pas de redirection ouverte)", async () => {
    const [a, b] = [await env.ebook('A'), await env.ebook('B')];
    const u = await env.register();
    const evil = await env.http.post('/v1/orders').set(auth(u.token)).send({ ebookIds: [a.id], returnUrl: 'https://pirate.example/vol' }).expect(201);
    const ok = await env.http.post('/v1/orders').set(auth(u.token)).send({ ebookIds: [b.id], returnUrl: 'exp://127.0.0.1:8081/--/checkout/return' }).expect(201);
    const payEvil = await env.prisma.payment.findFirstOrThrow({ where: { orderId: evil.body.order.id } });
    const payOk = await env.prisma.payment.findFirstOrThrow({ where: { orderId: ok.body.order.id } });
    assert.equal(payEvil.returnUrl, 'folio://checkout/return');
    assert.equal(payOk.returnUrl, 'exp://127.0.0.1:8081/--/checkout/return');
  });

  it('refuse de racheter un e-book déjà possédé', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await env.pay(u.token, [e.id]);
    await env.http.post('/v1/orders').set(auth(u.token)).send({ ebookIds: [e.id] }).expect(409);
    await env.http.post('/v1/cart/items').set(auth(u.token)).send({ ebookId: e.id }).expect(409);
  });

  it('CA-21 : la progression est synchronisée entre appareils', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await env.pay(u.token, [e.id]);
    await env.http.put(`/v1/library/${e.id}/progress`).set(auth(u.token)).send({ chapterIndex: 0, blockIndex: 8, percent: 40 }).expect(200);
    const lib = await env.http.get('/v1/library').set(auth(u.token));
    assert.equal(lib.body[0].progress.percent, 40);
  });

  it('CA-25 : un e-book dépublié reste lisible par ses acheteurs', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await env.pay(u.token, [e.id]);
    await env.prisma.ebook.update({ where: { id: e.id }, data: { status: 'DRAFT' } });
    assert.equal((await env.http.get('/v1/catalog/ebooks')).body.total, 0);
    await env.http.get(`/v1/library/${e.id}/content`).set(auth(u.token)).expect(200);
  });

  it('annule les commandes restées en attente', async () => {
    const e = await env.ebook();
    const u = await env.register();
    const o = await env.order(u.token, [e.id]);
    await env.prisma.order.update({ where: { id: o.orderId }, data: { createdAt: new Date(Date.now() - 24 * 3600_000) } });
    const { OrdersService } = await import('../orders/orders.service.js');
    assert.equal(await env.app.get(OrdersService).cancelStale(), 1);
    // Un paiement confirmé en retard reste honoré : l'argent a été encaissé.
    await env.webhook({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', sessionId: o.sessionId, paymentId: 'pi_late' }).expect(200);
    assert.equal((await env.prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).status, 'PAID');
  });
});
