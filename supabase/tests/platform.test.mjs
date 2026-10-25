import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { anon } from './lib.mjs';
import { Env, rpcError } from './helpers.mjs';

describe('Compte de la plateforme (Stripe de l’administrateur)', () => {
  let env;
  before(async () => (env = await Env.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  it('revenus : commission de 2 % des vendeurs et ventes des livres de la plateforme, remboursements déduits', async () => {
    const admin = await env.admin();
    const seller = await env.register('Vendeuse');
    const buyer = await env.register('Acheteur');
    const sold = await env.ebook('Livre de vendeur', { priceCents: 1000 });
    await env.sql.query('update public.ebooks set seller_id = $1 where id = $2', [seller.id, sold.id]);
    const own = await env.ebook('Livre Kalam', { priceCents: 500 });
    await env.pay(buyer, [sold.id, own.id]);

    assert.equal((await rpcError(seller.c.rpc('admin_platform_revenue'))).code, '42501');
    let rev = (await admin.c.rpc('admin_platform_revenue')).data;
    assert.equal(rev.commissionPercent, 2);
    assert.deepEqual(rev.byCurrency, [{ currency: 'EUR', commissionCents: 20, platformSalesCents: 500, collected: { CARD: 1500 }, owedToSellersCents: 980 }]);

    // La commission est exposée à l'app (affichée aux vendeurs).
    assert.equal((await anon().rpc('public_config')).data.commissionPercent, 2);

    // Remboursement avant versement : la commission disparaît des revenus.
    const { rows: [o] } = await env.sql.query('select id from public.orders limit 1');
    await env.fn('admin', { token: admin.token, body: { action: 'refund', orderId: o.id } });
    rev = (await admin.c.rpc('admin_platform_revenue')).data;
    assert.equal(rev.byCurrency[0].commissionCents, 0);
    assert.equal(rev.byCurrency[0].owedToSellersCents, 0);
  });

  it('configuration des paiements : visible par l’admin seul, sans aucune clé', async () => {
    const admin = await env.admin();
    const user = await env.register('Client');
    assert.equal((await env.fn('admin', { token: user.token, body: { action: 'payments-config' } })).status, 403);
    const r = await env.fn('admin', { token: admin.token, body: { action: 'payments-config' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.card.provider, 'fake');
    assert.match(r.body.card.webhookUrl, /\/functions\/v1\/payment-webhook$/);
    assert.equal(/sk_(test|live)_|whsec_/.test(r.text), false, 'aucun secret renvoyé');
  });
});
