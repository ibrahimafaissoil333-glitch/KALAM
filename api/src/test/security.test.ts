import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { buildEpub } from '../epub/build-epub.js';
import { TestEnv, auth } from './helpers.js';

describe('Sécurité et administration', () => {
  let env: TestEnv;
  before(async () => (env = await TestEnv.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  it("CA-19 : un client ne peut pas accéder au fichier d'un autre compte", async () => {
    const e = await env.ebook();
    const alice = await env.register('Alice');
    const bob = await env.register('Bob');
    await env.pay(alice.token, [e.id]);

    await env.http.get(`/v1/library/${e.id}/content`).set(auth(bob.token)).expect(403);
    await env.http.post(`/v1/library/${e.id}/download-url`).set(auth(bob.token)).expect(403);
    await env.http.put(`/v1/library/${e.id}/progress`).set(auth(bob.token)).send({ chapterIndex: 0, blockIndex: 0, percent: 1 }).expect(403);

    // La commande d'Alice est invisible pour Bob (pas d'IDOR).
    const aliceOrder = await env.prisma.order.findFirstOrThrow({ where: { userId: alice.id } });
    await env.http.get(`/v1/orders/${aliceOrder.id}`).set(auth(bob.token)).expect(404);
  });

  it('CA-20 : URL signée valable, puis refusée si falsifiée ou expirée', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await env.pay(u.token, [e.id]);
    const res = await env.http.post(`/v1/library/${e.id}/download-url`).set(auth(u.token)).expect(200);
    const url = new URL(res.body.url);
    const path = url.pathname + url.search;
    const file = await env.http.get(path).expect(200);
    assert.equal(file.headers['content-type'], 'application/epub+zip');

    const tampered = new URL(url);
    tampered.searchParams.set('key', tampered.searchParams.get('key')!.replace('main', 'content'));
    await env.http.get(tampered.pathname + tampered.search).expect(403);

    const expired = new URL(url);
    expired.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 10));
    await env.http.get(expired.pathname + expired.search).expect(403);
  });

  it('refuse le téléchargement si le propriétaire ne l’autorise pas, et applique la limite', async () => {
    const locked = await env.ebook('Verrouillé', { downloadAllowed: false });
    const open = await env.ebook('Ouvert');
    const u = await env.register();
    await env.pay(u.token, [locked.id, open.id]);
    await env.http.post(`/v1/library/${locked.id}/download-url`).set(auth(u.token)).expect(403);
    await env.prisma.setting.create({ data: { key: 'app', value: { maxDownloadsPerBook: 1 } } });
    await env.http.post(`/v1/library/${open.id}/download-url`).set(auth(u.token)).expect(200);
    await env.http.post(`/v1/library/${open.id}/download-url`).set(auth(u.token)).expect(429);
  });

  it('CA-22 : un remboursement retire l’accès', async () => {
    const e = await env.ebook();
    const u = await env.register();
    const admin = await env.admin();
    const o = await env.pay(u.token, [e.id]);
    await env.http.post(`/v1/admin/orders/${o.orderId}/refund`).set(auth(admin.token)).expect(200);
    assert.equal((await env.http.get('/v1/library').set(auth(u.token))).body.length, 0);
    await env.http.get(`/v1/library/${e.id}/content`).set(auth(u.token)).expect(403);
    assert.ok(env.mail.outbox.some((m) => m.kind === 'order_refunded'));
  });

  it('CA-23 : un client ne peut pas appeler les routes admin', async () => {
    const u = await env.register();
    await env.http.get('/v1/admin/orders').set(auth(u.token)).expect(403);
    await env.http.get('/v1/admin/stats').set(auth(u.token)).expect(403);
    await env.http.post('/v1/admin/ebooks').set(auth(u.token)).send({ title: 'x', author: 'y' }).expect(403);
    await env.http.get('/v1/admin/orders').expect(401);
  });

  it("un client ne peut pas s'élever au rôle admin en ajoutant un champ", async () => {
    const res = await env.http.post('/v1/auth/register').send({ name: 'X', email: 'x@test.fr', password: 'motdepasse1', acceptTerms: true, role: 'ADMIN' }).expect(400);
    assert.match(JSON.stringify(res.body), /role/);
    const u = await env.register();
    await env.http.patch('/v1/me').set(auth(u.token)).send({ role: 'ADMIN' }).expect(400);
  });

  it('résiste à une injection dans la recherche', async () => {
    await env.ebook();
    const res = await env.http.get(`/v1/catalog/ebooks?q=${encodeURIComponent("'; DROP TABLE ebooks; --")}`).expect(200);
    assert.equal(res.body.total, 0);
    assert.equal(await env.prisma.ebook.count(), 1);
  });

  it('CA-24 / CA-27 : création, envoi EPUB, publication et journal', async () => {
    const admin = await env.admin();
    const created = await env.http.post('/v1/admin/ebooks').set(auth(admin.token)).send({ title: 'Nouveau livre', author: 'Auteur', category: 'Roman', description: 'Texte' }).expect(201);
    const id = created.body.id;
    assert.deepEqual(created.body.publishable.sort(), ['Contenu lisible non extrait (EPUB requis pour la lecture dans l’app)', 'Fichier principal manquant', 'Prix à définir'].sort());
    await env.http.post(`/v1/admin/ebooks/${id}/publish`).set(auth(admin.token)).expect(400);

    await env.http.patch(`/v1/admin/ebooks/${id}`).set(auth(admin.token)).send({ priceCents: 990 }).expect(200);
    const epub = await buildEpub({ title: 'Nouveau livre', author: 'Auteur', chapters: [{ title: 'Ch 1', paragraphs: ['Bonjour'] }] });
    const up = await env.http.post(`/v1/admin/ebooks/${id}/files/main`).set(auth(admin.token)).attach('file', epub, { filename: 'livre.epub', contentType: 'application/epub+zip' }).expect(200);
    assert.deepEqual(up.body.publishable, []);
    await env.http.post(`/v1/admin/ebooks/${id}/files/main`).set(auth(admin.token)).attach('file', Buffer.from('pas un epub'), { filename: 'x.epub', contentType: 'application/epub+zip' }).expect(400);

    await env.http.post(`/v1/admin/ebooks/${id}/publish`).set(auth(admin.token)).expect(200);
    const cat = await env.http.get('/v1/catalog/ebooks').expect(200);
    assert.equal(cat.body.items[0].title, 'Nouveau livre');

    const actions = (await env.prisma.auditLog.findMany()).map((l) => l.action);
    for (const a of ['ebook.create', 'ebook.price', 'ebook.upload.main', 'ebook.publish']) assert.ok(actions.includes(a), a);
  });

  it('CA-26 : le chiffre d’affaires exclut les remboursements', async () => {
    const [a, b] = [await env.ebook('A', { priceCents: 1000 }), await env.ebook('B', { priceCents: 500 })];
    const admin = await env.admin();
    const u = await env.register();
    await env.pay(u.token, [a.id]);
    const refunded = await env.pay(u.token, [b.id]);
    await env.http.post(`/v1/admin/orders/${refunded.orderId}/refund`).set(auth(admin.token)).expect(200);
    const stats = await env.http.get('/v1/admin/stats?period=30d').set(auth(admin.token)).expect(200);
    assert.equal(stats.body.revenueCents, 1000);
    assert.equal(stats.body.paidOrders, 1);
  });

  it('export CSV neutralise les formules', async () => {
    const e = await env.ebook('=HYPERLINK("http://x")');
    const admin = await env.admin();
    const u = await env.register('=cmd');
    await env.pay(u.token, [e.id]);
    const csv = await env.http.get('/v1/admin/orders/export.csv').set(auth(admin.token)).expect(200);
    assert.ok(!/;"=/.test(csv.text));
    assert.ok(csv.text.includes(`"'=cmd"`));
  });

  it('RGPD : export puis suppression du compte, commandes conservées', async () => {
    const e = await env.ebook();
    const u = await env.register('Sarah', 'sarah@test.fr');
    await env.pay(u.token, [e.id]);
    const exp = await env.http.get('/v1/me/export').set(auth(u.token)).expect(200);
    assert.equal(exp.body.orders.length, 1);
    await env.http.delete('/v1/me').set(auth(u.token)).send({ password: 'mauvais' }).expect(400);
    await env.http.delete('/v1/me').set(auth(u.token)).send({ password: 'motdepasse1' }).expect(204);
    const row = await env.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(row.email, null);
    assert.equal(row.status, 'DELETED');
    assert.equal(await env.prisma.order.count({ where: { userId: u.id } }), 1);
    await env.http.get('/v1/me').set(auth(u.token)).expect(401);
  });
});
