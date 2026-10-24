import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { anon } from './lib.mjs';
import { Env, rpcError } from './helpers.mjs';

describe('PayPal et administration des vendeurs', () => {
  let env;
  before(async () => (env = await Env.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  const paypalCheckout = (u, ebookIds) =>
    env.fn('checkout', { token: u.token, headers: { 'idempotency-key': randomUUID() }, body: { ebookIds, paymentMethod: 'PAYPAL', returnUrl: 'folio://checkout/return' } });

  it('PayPal désactivé par défaut, réservé aux commandes en euros, confirmé par le prestataire', async () => {
    const admin = await env.admin();
    const buyer = await env.register('Acheteur');
    const eur = await env.ebook('Livre en euros');
    const kmf = await env.ebook('Livre en francs');
    await env.sql.query("update public.ebooks set currency = 'KMF' where id = $1", [kmf.id]);

    assert.equal((await anon().rpc('public_config')).data.paypal.enabled, false);
    assert.equal((await paypalCheckout(buyer, [eur.id])).status, 409, 'option désactivée');

    assert.equal((await rpcError(buyer.c.rpc('admin_put_settings', { p: { paypalEnabled: true } }))).code, '42501');
    assert.equal((await rpcError(admin.c.rpc('admin_put_settings', { p: { paypalEnabled: 'oui' } }))).code, 'PT400');
    await admin.c.rpc('admin_put_settings', { p: { paypalEnabled: true } });
    assert.deepEqual((await anon().rpc('public_config')).data.paypal, { enabled: true, currencies: ['EUR'] });

    assert.equal((await paypalCheckout(buyer, [kmf.id])).status, 400, 'PayPal refuse le KMF');
    const r = await paypalCheckout(buyer, [eur.id]);
    assert.equal(r.status, 201, r.text);
    assert.ok(r.body.checkoutUrl);
    const { rows: [pay] } = await env.sql.query('select provider_session_id, method from public.payments where order_id = $1', [r.body.order.id]);
    assert.equal(pay.method, 'PAYPAL');
    // Aucun accès avant la confirmation du prestataire.
    assert.equal((await buyer.c.rpc('my_library')).data.length, 0);
    await env.webhook({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', sessionId: pay.provider_session_id, paymentId: `cap_${randomUUID()}` });
    const order = (await buyer.c.rpc('my_order', { p_id: r.body.order.id })).data;
    assert.equal(order.status, 'PAID');
    assert.equal(order.paymentMethod, 'PAYPAL');
    assert.equal((await buyer.c.rpc('my_library')).data.length, 1);
  });

  it('l’admin voit les ventes de chaque vendeur ; refusé aux autres', async () => {
    const admin = await env.admin();
    const seller = await env.register('Vendeuse');
    const buyer = await env.register('Acheteur');
    const e = await env.ebook('Livre vendu', { priceCents: 1000 });
    await env.sql.query('update public.ebooks set seller_id = $1 where id = $2', [seller.id, e.id]);
    await env.pay(buyer, [e.id]);

    assert.equal((await rpcError(seller.c.rpc('admin_sellers'))).code, '42501');
    const [row] = (await admin.c.rpc('admin_sellers')).data;
    assert.equal(row.name, 'Vendeuse');
    assert.equal(row.sold, 1);
    assert.deepEqual(row.totals, [{ currency: 'EUR', grossCents: 1000, commissionCents: 20, netCents: 980, availableCents: 980 }]);
    const detail = (await admin.c.rpc('admin_seller', { p_id: seller.id })).data;
    assert.equal(detail.sales[0].buyer.name, 'Acheteur');
    assert.equal(detail.sales[0].netCents, 980);
    assert.equal(detail.listings.length, 1);
  });

  it('l’admin retire une annonce à tout moment : hors catalogue, paniers vidés, vendeur prévenu, acheteurs servis', async () => {
    const admin = await env.admin();
    const seller = await env.register('Vendeuse');
    const buyer = await env.register('Acheteur');
    const other = await env.register('Autre');
    const e = await env.ebook('Annonce');
    await env.sql.query('update public.ebooks set seller_id = $1 where id = $2', [seller.id, e.id]);
    await env.pay(buyer, [e.id]);
    await other.c.rpc('cart_add', { p_ebook: e.id });

    assert.equal((await rpcError(seller.c.rpc('admin_moderate_listing', { p_id: e.id, p_action: 'remove' }))).code, '42501');
    const removed = (await admin.c.rpc('admin_moderate_listing', { p_id: e.id, p_action: 'remove', p_reason: 'Contenu non autorisé' })).data;
    assert.equal(removed.status, 'ARCHIVED');
    assert.equal((await anon().rpc('search_ebooks', {})).data.total, 0);
    assert.equal((await other.c.rpc('cart_get')).data.count, 0);
    const [mail] = await env.outbox('listing_removed');
    assert.match(mail.body, /Contenu non autorisé/);
    assert.equal((await buyer.c.rpc('my_library')).data.length, 1, 'l’acheteur garde son livre');
    // Le vendeur ne peut pas la remettre en vente lui-même… mais l'admin oui.
    assert.equal((await admin.c.rpc('admin_moderate_listing', { p_id: e.id, p_action: 'restore' })).data.status, 'PUBLISHED');
  });
});
