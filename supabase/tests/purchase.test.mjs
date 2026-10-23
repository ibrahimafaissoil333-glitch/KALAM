import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { anon } from './lib.mjs';
import { Env } from './helpers.mjs';

describe('Catalogue, panier, paiement et bibliothèque', () => {
  let env;
  before(async () => (env = await Env.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  it('CA-01 / CA-02 / CA-04 : catalogue publié, recherche sans accents, tri', async () => {
    await env.ebook('Les Nuits de Tanger');
    await env.ebook('Été à Alger');
    await env.ebook('Brouillon', { status: 'DRAFT' });
    const c = anon();
    assert.equal((await c.rpc('search_ebooks', {})).data.total, 2);
    const q = (await c.rpc('search_ebooks', { p_q: 'ete' })).data;
    assert.deepEqual(q.items.map((e) => e.title), ['Été à Alger']);
    const sorted = (await c.rpc('search_ebooks', { p_sort: 'title' })).data;
    assert.deepEqual(sorted.items.map((e) => e.title), ['Été à Alger', 'Les Nuits de Tanger']);
    assert.equal((await c.rpc('search_ebooks', { p_q: 'zzz' })).data.total, 0);
    // Un brouillon n'est pas lisible directement non plus (RLS).
    assert.equal((await c.from('ebooks').select('id').eq('title', 'Brouillon')).data.length, 0);
  });

  it('CA-06 : extrait gratuit sans compte, limité aux premiers blocs', async () => {
    const e = await env.ebook();
    await env.sql.query('update public.ebooks set preview_blocks = 3 where id = $1', [e.id]);
    const r = await env.fn('preview', { body: { slug: e.slug } });
    assert.equal(r.status, 200);
    assert.equal(r.body.chapters.flatMap((c) => c.blocks).length, 3);
  });

  it('CA-13 : fusion du panier invité sans doublon', async () => {
    const [a, b, c] = [await env.ebook('A'), await env.ebook('B'), await env.ebook('C')];
    const u = await env.register();
    await u.c.rpc('cart_add', { p_ebook: a.id });
    const merged = (await u.c.rpc('cart_merge', { p_ebooks: [a.id, b.id, c.id] })).data;
    assert.equal(merged.count, 3);
    assert.equal(merged.totalCents, 3 * 1299);
  });

  it("CA-14 / CA-15 / CA-17 : le webhook confirme, l'accès est activé une seule fois", async () => {
    const e = await env.ebook();
    const u = await env.register();
    const o = await env.order(u, [e.id]);
    assert.equal((await u.c.rpc('my_order', { p_id: o.orderId })).data.status, 'PENDING');
    assert.equal((await u.c.rpc('my_library')).data.length, 0);
    assert.equal((await env.fn('library', { token: u.token, body: { action: 'content', ebookId: e.id } })).status, 403);

    const event = { id: `evt_${randomUUID()}`, type: 'payment.succeeded', sessionId: o.sessionId, paymentId: 'pi_1' };
    assert.equal((await env.webhook(event)).body.result, 'applied');
    assert.equal((await env.webhook(event)).body.result, 'duplicate');

    assert.equal((await u.c.rpc('my_order', { p_id: o.orderId })).data.status, 'PAID');
    assert.equal((await u.c.rpc('my_library')).data.length, 1);
    assert.equal((await env.outbox('order_confirmed')).length, 1);
    const content = await env.fn('library', { token: u.token, body: { action: 'content', ebookId: e.id } });
    assert.equal(content.status, 200);
    assert.ok(content.body.chapters.length > 0);
  });

  it('CA-16 : échec de paiement, panier conservé, aucun accès', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await u.c.rpc('cart_add', { p_ebook: e.id });
    const o = await env.order(u, []);
    await env.webhook({ id: `evt_${randomUUID()}`, type: 'payment.failed', sessionId: o.sessionId, reason: 'card_declined' });
    assert.equal((await u.c.rpc('my_order', { p_id: o.orderId })).data.status, 'FAILED');
    assert.equal((await u.c.rpc('cart_get')).data.count, 1);
    assert.equal((await env.sql.query('select count(*)::int n from public.entitlements')).rows[0].n, 0);
    assert.equal((await env.outbox('payment_failed')).length, 1);
  });

  it('CA-18 : un webhook à la signature invalide est rejeté sans effet', async () => {
    const e = await env.ebook();
    const u = await env.register();
    const o = await env.order(u, [e.id]);
    const body = { id: 'evt_forge', type: 'payment.succeeded', sessionId: o.sessionId };
    assert.equal((await env.webhook(body, { signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` })).status, 400);
    assert.equal((await env.webhook(body, { signature: env.sign(JSON.stringify(body), Math.floor(Date.now() / 1000) - 3600) })).status, 400);
    assert.equal((await env.fn('payment-webhook', { body })).status, 400);
    assert.equal((await env.sql.query('select count(*)::int n from public.entitlements')).rows[0].n, 0);
  });

  it('un client ne peut ni créer de droit ni marquer une commande payée lui-même', async () => {
    const e = await env.ebook();
    const u = await env.register();
    const o = await env.order(u, [e.id]);
    await u.c.from('entitlements').insert({ user_id: u.id, ebook_id: e.id });
    await u.c.from('orders').update({ status: 'PAID' }).eq('id', o.orderId);
    assert.ok((await u.c.rpc('svc_mark_paid', { p_provider: 'fake', p_event: 'x', p_session: o.sessionId, p_payment_ref: null, p_tax: null, p_country: null })).error);
    assert.equal((await env.sql.query('select count(*)::int n from public.entitlements')).rows[0].n, 0);
    assert.equal((await env.sql.query('select status from public.orders where id = $1', [o.orderId])).rows[0].status, 'PENDING');
  });

  it('Idempotency-Key : un double appui ne crée qu’une commande', async () => {
    const e = await env.ebook();
    const u = await env.register();
    const send = () => env.fn('checkout', { token: u.token, body: { ebookIds: [e.id] }, headers: { 'idempotency-key': 'clic-1' } });
    const [a, b] = await Promise.all([send(), send()]);
    assert.equal(a.body.order.id, b.body.order.id);
    assert.equal((await env.sql.query('select count(*)::int n from public.orders')).rows[0].n, 1);
  });

  it("n'accepte que les adresses de retour autorisées", async () => {
    const [a, b] = [await env.ebook('A'), await env.ebook('B')];
    const u = await env.register();
    const evil = await env.order(u, [a.id], { returnUrl: 'https://pirate.example/vol' });
    const ok = await env.order(u, [b.id], { returnUrl: 'exp://127.0.0.1:8081/--/checkout/return' });
    const q = (id) => env.sql.query('select return_url from public.payments where order_id = $1', [id]).then((r) => r.rows[0].return_url);
    assert.equal(await q(evil.orderId), 'folio://checkout/return');
    assert.equal(await q(ok.orderId), 'exp://127.0.0.1:8081/--/checkout/return');
  });

  it('refuse de racheter un e-book déjà possédé', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await env.pay(u, [e.id]);
    assert.equal((await env.fn('checkout', { token: u.token, body: { ebookIds: [e.id] } })).status, 409);
    assert.match((await u.c.rpc('cart_add', { p_ebook: e.id })).error.message, /déjà dans votre bibliothèque/);
  });

  it('CA-21 : la progression est synchronisée', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await env.pay(u, [e.id]);
    assert.equal((await u.c.rpc('save_progress', { p_ebook: e.id, p_chapter: 0, p_block: 8, p_percent: 40 })).error, null);
    assert.equal((await u.c.rpc('my_library')).data[0].progress.percent, 40);
  });

  it('CA-25 : un e-book dépublié reste lisible par ses acheteurs', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await env.pay(u, [e.id]);
    await env.sql.query(`update public.ebooks set status = 'DRAFT' where id = $1`, [e.id]);
    assert.equal((await anon().rpc('search_ebooks', {})).data.total, 0);
    assert.equal((await env.fn('library', { token: u.token, body: { action: 'content', ebookId: e.id } })).status, 200);
    assert.equal((await u.c.rpc('ebook_detail', { p_slug: e.slug })).data.owned, true);
  });

  it('annule les commandes restées en attente ; un paiement tardif reste honoré', async () => {
    const e = await env.ebook();
    const u = await env.register();
    const o = await env.order(u, [e.id]);
    await env.sql.query(`update public.orders set created_at = now() - interval '1 day' where id = $1`, [o.orderId]);
    assert.equal((await env.sql.query('select public.cancel_stale_orders(60) n')).rows[0].n, 1);
    await env.webhook({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', sessionId: o.sessionId, paymentId: 'pi_late' });
    assert.equal((await env.sql.query('select status from public.orders where id = $1', [o.orderId])).rows[0].status, 'PAID');
  });
});
