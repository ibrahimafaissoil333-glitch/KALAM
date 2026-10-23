import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { anon, buildEpub } from './lib.mjs';
import { CRON_SECRET, Env, mmSign, rpcError } from './helpers.mjs';

const IBAN = 'FR7630006000011234567890189';

describe('Marketplace, Mobile Money et reversements', () => {
  let env;
  before(async () => (env = await Env.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  /** Annonce créée par le vendeur, comme dans l'app (fonctions seller_* et envoi du fichier). */
  async function listing(seller, { kind = 'DIGITAL', title = `Livre ${randomUUID().slice(0, 4)}`, currency = 'KMF', priceCents = 500000, stock = 1, publish = true } = {}) {
    const base = { title, author: 'Auteur', description: 'Bon livre', category: 'Roman', currency, priceCents, kind };
    const { data: e, error } = await seller.c.rpc('seller_save_ebook', { p_id: null, p: kind === 'PHYSICAL' ? { ...base, condition: 'GOOD', stock } : base });
    if (error) throw error;
    if (kind === 'DIGITAL') {
      const form = new FormData();
      form.set('ebookId', e.id);
      form.set('kind', 'main');
      form.set('file', new Blob([await buildEpub({ title, author: 'Auteur', chapters: [{ title: 'Un', paragraphs: ['Texte'] }] })], { type: 'application/epub+zip' }), 'livre.epub');
      const up = await env.fn('seller', { token: seller.token, form });
      assert.equal(up.status, 200, up.text);
    } else {
      const r = await seller.c.rpc('seller_set_shipping', { p_id: e.id, p: [{ mode: 'HAND', priceCents: 0 }, { mode: 'POST', priceCents: 100000, countries: ['KM'] }] });
      if (r.error) throw r.error;
    }
    if (publish) {
      const r = await seller.c.rpc('seller_set_status', { p_id: e.id, p_action: 'publish' });
      if (r.error) throw r.error;
    }
    const { data } = await seller.c.rpc('seller_ebook', { p_id: e.id });
    return data;
  }

  async function enableMobileMoney(admin, patch = { enabled: true }) {
    const r = await admin.c.rpc('admin_set_mobile_money', { p: patch });
    if (r.error) throw r.error;
    return r.data;
  }

  const mmCheckout = (u, ebookIds, extra = {}, mobileMoney = { country: 'KM', operator: 'HURI_MONEY', phone: '+269 321 23 45' }) =>
    env.fn('checkout', { token: u.token, headers: { 'idempotency-key': randomUUID() }, body: { ebookIds, paymentMethod: 'MOBILE_MONEY', mobileMoney, ...extra } });

  async function session(orderId) {
    return (await env.sql.query('select provider_session_id from public.payments where order_id = $1', [orderId])).rows[0].provider_session_id;
  }
  const phone = (sessionId, outcome) => env.fn(`fake-mobile-money/${sessionId}?outcome=${outcome}`, {});
  const orderStatus = async (id) => (await env.sql.query('select status from public.orders where id = $1', [id])).rows[0].status;

  // ── Vente par tous les utilisateurs ──────────────────────────

  it('un utilisateur met en vente, met en pause, et seul lui peut modifier son annonce', async () => {
    const seller = await env.register('Vendeur');
    const other = await env.register('Autre');
    assert.match((await rpcError(seller.c.rpc('seller_save_ebook', { p_id: null, p: { title: 'Sans type', author: 'A' } }))).message, /Livre physique.*Livre numérique/);
    const e = await listing(seller);
    assert.equal(e.status, 'PUBLISHED');
    assert.equal(e.seller.name, 'Vendeur');
    assert.equal((await anon().rpc('search_ebooks', {})).data.total, 1);

    assert.equal((await rpcError(other.c.rpc('seller_save_ebook', { p_id: e.id, p: { priceCents: 1 } }))).code, 'PT404');
    assert.equal((await rpcError(other.c.rpc('seller_set_status', { p_id: e.id, p_action: 'pause' }))).code, 'PT404');

    await seller.c.rpc('seller_set_status', { p_id: e.id, p_action: 'pause' });
    assert.equal((await anon().rpc('search_ebooks', {})).data.total, 0, 'une annonce en pause est masquée');
    assert.equal((await seller.c.rpc('seller_dashboard')).data.listings.paused, 1);
  });

  it('livre physique : état, stock et livraison obligatoires ; pas de fichier', async () => {
    const seller = await env.register('Vendeur');
    const { data: e } = await seller.c.rpc('seller_save_ebook', { p_id: null, p: { title: 'Papier', author: 'A', description: 'd', category: 'Roman', priceCents: 1000, currency: 'EUR', kind: 'PHYSICAL' } });
    assert.deepEqual([...e.publishable].sort(), ['Au moins un mode de livraison', 'Quantité en stock manquante', 'État du livre manquant'].sort());
    assert.match((await rpcError(seller.c.rpc('seller_set_status', { p_id: e.id, p_action: 'publish' }))).message, /Mise en vente impossible/);
    assert.equal((await rpcError(seller.c.rpc('seller_save_ebook', { p_id: e.id, p: { condition: 'CASSE' } }))).code, 'PT400');
    const form = new FormData();
    form.set('ebookId', e.id);
    form.set('kind', 'main');
    form.set('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'livre.pdf');
    assert.equal((await env.fn('seller', { token: seller.token, form })).status, 400);
  });

  it('filtre physique / numérique et badge dans le catalogue', async () => {
    const seller = await env.register('Vendeur');
    await listing(seller, { kind: 'DIGITAL', title: 'Numérique' });
    await listing(seller, { kind: 'PHYSICAL', title: 'Papier' });
    const c = anon();
    assert.deepEqual((await c.rpc('search_ebooks', { p_kind: 'PHYSICAL' })).data.items.map((i) => [i.title, i.kind, i.condition]), [['Papier', 'PHYSICAL', 'GOOD']]);
    assert.deepEqual((await c.rpc('search_ebooks', { p_kind: 'DIGITAL' })).data.items.map((i) => i.kind), ['DIGITAL']);
    assert.equal((await rpcError(c.rpc('search_ebooks', { p_kind: 'AUTRE' }))).code, 'PT400');
  });

  it('un vendeur ne peut pas acheter son livre ni supprimer une annonce déjà vendue', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const seller = await env.register('Vendeur');
    const buyer = await env.register('Acheteur');
    const e = await listing(seller);
    assert.equal((await rpcError(seller.c.rpc('cart_add', { p_ebook: e.id }))).code, 'PT409');
    const r = await mmCheckout(buyer, [e.id]);
    await phone(await session(r.body.order.id), 'succeeded');
    assert.equal((await env.fn('seller', { token: seller.token, body: { action: 'delete', id: e.id } })).status, 409);
  });

  // ── Activation par l'admin ───────────────────────────────────

  it('Mobile Money désactivé par défaut : option masquée et refusée par le serveur', async () => {
    const seller = await env.register('Vendeur');
    const buyer = await env.register('Acheteur');
    const e = await listing(seller);
    const cfg = (await anon().rpc('public_config')).data;
    assert.equal(cfg.mobileMoney.enabled, false);
    assert.deepEqual(cfg.mobileMoney.countries, []);
    const r = await mmCheckout(buyer, [e.id]);
    assert.equal(r.status, 409);
    assert.equal((await env.sql.query("select count(*)::int n from public.ebooks where id = $1 and stock is null", [e.id])).rows[0].n, 1);
  });

  it('seul un admin modifie les réglages ; pays et opérateurs, avec historique', async () => {
    const admin = await env.admin();
    const user = await env.register('Client');
    assert.equal((await rpcError(user.c.rpc('admin_set_mobile_money', { p: { enabled: true } }))).code, '42501');
    assert.equal((await rpcError(user.c.rpc('admin_mobile_money_log'))).code, '42501');
    assert.equal((await rpcError(anon().rpc('admin_set_mobile_money', { p: { enabled: true } }))).code, '42501');
    // Lecture / écriture directe de la table des réglages impossible.
    await user.c.from('settings').upsert({ key: 'mobile_money', value: { enabled: true } });
    assert.equal((await anon().rpc('public_config')).data.mobileMoney.enabled, false);

    await enableMobileMoney(admin);
    await enableMobileMoney(admin, { countries: { KM: { operators: { HURI_MONEY: { enabled: false } } }, MG: { enabled: false } } });
    const cfg = (await anon().rpc('public_config')).data.mobileMoney;
    assert.deepEqual(cfg.countries.map((c) => [c.code, c.operators.map((o) => o.code)]), [['KM', ['MVOLA_KM']]]);
    assert.equal((await rpcError(admin.c.rpc('admin_set_mobile_money', { p: { enabled: 'oui' } }))).code, 'PT400');
    assert.equal((await rpcError(admin.c.rpc('admin_set_mobile_money', { p: { countries: { FR: { enabled: true } } } }))).code, 'PT400');

    const log = (await admin.c.rpc('admin_mobile_money_log')).data;
    assert.equal(log.length, 2);
    assert.equal(log[0].actor.email, admin.email);
    assert.equal(log[0].before.countries.MG.enabled, true);
    assert.equal(log[0].after.countries.MG.enabled, false);
    assert.ok(log[0].createdAt);
  });

  it('opérateur désactivé : refusé à la création, mais un paiement déjà lancé est honoré', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const seller = await env.register('Vendeur');
    const buyer = await env.register('Acheteur');
    const e = await listing(seller);
    const r = await mmCheckout(buyer, [e.id]);
    assert.equal(r.status, 201, r.text);
    await enableMobileMoney(admin, { enabled: false });
    await phone(await session(r.body.order.id), 'succeeded');
    assert.equal(await orderStatus(r.body.order.id), 'PAID');
    const other = await env.register('Autre');
    assert.equal((await mmCheckout(other, [e.id])).status, 409);
  });

  // ── Paiement Mobile Money ────────────────────────────────────

  it('paiement confirmé sur le téléphone : commande payée, livre dans la bibliothèque, gains du vendeur', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const seller = await env.register('Vendeur');
    const buyer = await env.register('Acheteur');
    const e = await listing(seller, { priceCents: 500000 });
    const r = await mmCheckout(buyer, [e.id]);
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.body.mobileMoney, { operator: 'HURI_MONEY', masked: '****2345' });
    const { rows: [pay] } = await env.sql.query('select * from public.payments where order_id = $1', [r.body.order.id]);
    assert.equal(pay.msisdn_last4, '2345');
    assert.equal(JSON.stringify(pay).includes('3212345'), false, 'le numéro complet n’est pas stocké');

    let st = await env.fn(`payment-status?order=${r.body.order.id}`, { token: buyer.token, method: 'GET' });
    assert.equal(st.body.status, 'PENDING');
    assert.equal((await buyer.c.rpc('my_library')).data.length, 0, 'pas d’accès avant confirmation');

    await phone(pay.provider_session_id, 'succeeded');
    st = await env.fn(`payment-status?order=${r.body.order.id}`, { token: buyer.token, method: 'GET' });
    assert.equal(st.body.status, 'PAID');
    assert.deepEqual((await buyer.c.rpc('my_library')).data.map((b) => b.id), [e.id]);

    const dash = (await seller.c.rpc('seller_dashboard')).data;
    assert.equal(dash.sold, 1);
    // Commission de 2 % sur le prix.
    assert.deepEqual(dash.earnings, [{ currency: 'KMF', availableCents: 490000, paidOutCents: 0, totalCents: 490000 }]);
    // Un autre utilisateur ne peut pas lire le statut.
    const other = await env.register('Autre');
    assert.equal((await env.fn(`payment-status?order=${r.body.order.id}`, { token: other.token, method: 'GET' })).status, 404);
  });

  it('paiement refusé : commande échouée, aucun accès, stock rendu', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const seller = await env.register('Vendeur');
    const buyer = await env.register('Acheteur');
    const e = await listing(seller, { kind: 'PHYSICAL', stock: 1 });
    const { data: addr } = await buyer.c.rpc('save_address', { p: { fullName: 'Acheteur', line1: 'Rue 1', city: 'Moroni', country: 'KM' } });
    const hand = e.shipping.find((s) => s.mode === 'HAND').id;
    // Numéro finissant par 0000 : refus simulé de l'opérateur.
    const r = await mmCheckout(buyer, [e.id], { shipping: { [e.id]: hand }, addressId: addr.id }, { country: 'KM', operator: 'MVOLA_KM', phone: '3210000' });
    assert.equal(r.status, 201, r.text);
    assert.equal((await env.sql.query('select stock from public.ebooks where id = $1', [e.id])).rows[0].stock, 0, 'stock réservé');
    await phone(await session(r.body.order.id));
    assert.equal(await orderStatus(r.body.order.id), 'FAILED');
    assert.equal((await env.sql.query('select stock from public.ebooks where id = $1', [e.id])).rows[0].stock, 1, 'stock rendu');
    assert.equal((await env.sql.query('select count(*)::int n from public.shipments')).rows[0].n, 0);
    assert.equal((await env.sql.query('select count(*)::int n from public.seller_earnings')).rows[0].n, 0);
  });

  it('callback falsifié rejeté, callback rejoué sans effet', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const seller = await env.register('Vendeur');
    const buyer = await env.register('Acheteur');
    const e = await listing(seller);
    const r = await mmCheckout(buyer, [e.id]);
    const sid = await session(r.body.order.id);
    const raw = JSON.stringify({ transactionId: 'tx-1', requestId: sid, status: 'SUCCESS' });
    const send = (signature) => env.fn('payment-webhook?provider=mobile_money', { form: raw, headers: { 'content-type': 'application/json', 'x-mm-signature': signature } });
    assert.equal((await send(mmSign(raw).replace(/v1=./, 'v1=0'))).status, 400);
    assert.equal((await send(mmSign(raw, Math.floor(Date.now() / 1000) - 3600))).status, 400, 'horodatage trop ancien');
    assert.equal(await orderStatus(r.body.order.id), 'PENDING');
    assert.equal((await send(mmSign(raw))).body.result, 'applied');
    assert.equal((await send(mmSign(raw))).body.result, 'duplicate');
    assert.equal((await env.sql.query('select count(*)::int n from public.seller_earnings')).rows[0].n, 1);
  });

  it('validation : numéro, devise du pays et opérateur', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const seller = await env.register('Vendeur');
    const buyer = await env.register('Acheteur');
    const kmf = await listing(seller);
    const eur = await listing(seller, { currency: 'EUR', priceCents: 990 });
    assert.equal((await mmCheckout(buyer, [kmf.id], {}, { country: 'KM', operator: 'HURI_MONEY', phone: '12' })).status, 400);
    assert.equal((await mmCheckout(buyer, [eur.id])).status, 400, 'Comores : commande en KMF');
    assert.equal((await mmCheckout(buyer, [kmf.id], {}, { country: 'KM', operator: 'ORANGE_MONEY', phone: '3212345' })).status, 409);
    assert.equal((await mmCheckout(buyer, [kmf.id, eur.id])).status, 400, 'une seule devise par commande');
  });

  it('stock : deux acheteurs simultanés pour le dernier exemplaire', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const seller = await env.register('Vendeur');
    const e = await listing(seller, { kind: 'PHYSICAL', stock: 1 });
    const hand = e.shipping.find((s) => s.mode === 'HAND').id;
    const buyers = await Promise.all([env.register('A'), env.register('B')]);
    const addrs = await Promise.all(buyers.map((b) => b.c.rpc('save_address', { p: { fullName: 'X', line1: 'Rue', city: 'Moroni', country: 'KM' } })));
    const res = await Promise.all(buyers.map((b, i) => mmCheckout(b, [e.id], { shipping: { [e.id]: hand }, addressId: addrs[i].data.id })));
    assert.deepEqual(res.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await env.sql.query('select stock from public.ebooks where id = $1', [e.id])).rows[0].stock, 0);
  });

  it('livre physique : adresse et livraison exigées, expédition suivie jusqu’à la réception', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const seller = await env.register('Vendeur');
    const buyer = await env.register('Acheteur');
    const e = await listing(seller, { kind: 'PHYSICAL', stock: 2 });
    assert.equal((await mmCheckout(buyer, [e.id])).status, 400, 'adresse manquante');
    const { data: addr } = await buyer.c.rpc('save_address', { p: { fullName: 'Acheteur', line1: 'Rue 1', city: 'Antananarivo', country: 'MG' } });
    const post = e.shipping.find((s) => s.mode === 'POST').id;
    assert.equal((await mmCheckout(buyer, [e.id], { shipping: { [e.id]: post }, addressId: addr.id })).status, 400, 'pays non desservi');
    const { data: km } = await buyer.c.rpc('save_address', { p: { fullName: 'Acheteur', line1: 'Rue 1', city: 'Moroni', country: 'KM' } });
    const r = await mmCheckout(buyer, [e.id], { shipping: { [e.id]: post }, addressId: km.id });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.order.totalCents, 600000, 'prix + frais de livraison');
    await phone(await session(r.body.order.id), 'succeeded');

    assert.equal((await buyer.c.rpc('my_library')).data.length, 0, 'un livre physique n’entre pas dans la bibliothèque');
    const [ship] = (await seller.c.rpc('seller_shipments')).data;
    assert.equal(ship.address.city, 'Moroni');
    assert.equal((await (await env.register('Curieux')).c.rpc('seller_shipments')).data.length, 0, 'adresse invisible des autres');
    await seller.c.rpc('seller_mark_shipped', { p_shipment: ship.id, p_tracking: 'KM123' });
    const order = (await buyer.c.rpc('confirm_delivery', { p_shipment: ship.id })).data;
    assert.equal(order.shipments[0].status, 'DELIVERED');
    // Commission sur le prix seulement : 2 % de 500 000, la livraison revient au vendeur.
    const { rows: [earn] } = await env.sql.query('select gross_cents, commission_cents, net_cents from public.seller_earnings');
    assert.deepEqual(earn, { gross_cents: 600000, commission_cents: 10000, net_cents: 590000 });
  });

  // ── Accès aux livres numériques ──────────────────────────────

  it('livre numérique : téléchargement réservé aux acheteurs, plusieurs acheteurs indépendants', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const seller = await env.register('Vendeur');
    const e = await listing(seller);
    const [a, b, stranger] = await Promise.all([env.register('A'), env.register('B'), env.register('C')]);
    for (const u of [a, b]) {
      const r = await mmCheckout(u, [e.id]);
      await phone(await session(r.body.order.id), 'succeeded');
    }
    for (const u of [a, b]) {
      const d = await env.fn('library', { token: u.token, body: { action: 'download', ebookId: e.id } });
      assert.equal(d.status, 200, d.text);
      assert.match(d.body.url, /token=/);
    }
    assert.equal((await env.fn('library', { token: stranger.token, body: { action: 'download', ebookId: e.id } })).status, 403);
    assert.equal((await env.fn('library', { token: seller.token, body: { action: 'download', ebookId: e.id } })).status, 403);
    // Le fichier n'est pas accessible directement dans le stockage.
    const { data: files } = await stranger.c.storage.from('ebooks').list(e.id);
    assert.equal(files?.length ?? 0, 0);
    assert.equal((await rpcError(a.c.rpc('cart_add', { p_ebook: e.id }))).code, 'PT409', 'déjà possédé');
  });

  // ── Coordonnées de paiement et reversements ──────────────────

  it('coordonnées chiffrées en base et masquées ; affichage en clair réservé à l’admin, journalisé', async () => {
    const admin = await env.admin();
    const seller = await env.register('Vendeur');
    assert.equal((await env.fn('payout-accounts', { token: seller.token, body: { kind: 'BANK', holderName: 'Vendeur', country: 'FR', iban: 'FR7630006000011234567890188' } })).status, 400, 'clé IBAN fausse');
    const r = await env.fn('payout-accounts', { token: seller.token, body: { kind: 'BANK', holderName: 'Vendeur', country: 'FR', iban: IBAN.replace(/(.{4})/g, '$1 ') } });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body[0].masked, '****0189');
    assert.equal(JSON.stringify(r.body).includes(IBAN), false);
    const { rows: [row] } = await env.sql.query('select secret_ciphertext from public.seller_payout_accounts');
    assert.match(row.secret_ciphertext, /^v1:/);
    assert.equal(row.secret_ciphertext.includes('30006000011234567890'), false);
    assert.equal((await seller.c.from('seller_payout_accounts').select('*')).data.length, 0, 'aucune lecture directe');

    const id = r.body[0].id;
    assert.equal((await env.fn('admin', { token: seller.token, body: { action: 'reveal-payout-account', accountId: id } })).status, 403);
    const shown = await env.fn('admin', { token: admin.token, body: { action: 'reveal-payout-account', accountId: id } });
    assert.equal(shown.body.value, IBAN);
    assert.equal((await env.sql.query("select count(*)::int n from public.audit_logs where action = 'payout_account.reveal'")).rows[0].n, 1);

    const mm = await env.fn('payout-accounts', { token: seller.token, body: { kind: 'MOBILE_MONEY', holderName: 'Vendeur', country: 'MG', operator: 'MVOLA', phone: '034 12 345 67' } });
    assert.equal(mm.body.find((a) => a.kind === 'MOBILE_MONEY').masked, '****4567');
  });

  it('versement Mobile Money automatique, virement bancaire manuel, dette après remboursement', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    const sellerMm = await env.register('Vendeur MM');
    const sellerBank = await env.register('Vendeur Banque');
    await env.fn('payout-accounts', { token: sellerMm.token, body: { kind: 'MOBILE_MONEY', holderName: 'V', country: 'KM', operator: 'MVOLA_KM', phone: '3219999' } });
    await env.fn('payout-accounts', { token: sellerBank.token, body: { kind: 'BANK', holderName: 'V', country: 'FR', iban: IBAN } });
    const e1 = await listing(sellerMm);
    const e2 = await listing(sellerBank);
    const buyer = await env.register('Acheteur');
    const r = await mmCheckout(buyer, [e1.id, e2.id]);
    await phone(await session(r.body.order.id), 'succeeded');

    // Fonction de versement protégée par le secret du cron.
    assert.equal((await env.fn('payouts', { headers: { 'x-cron-secret': 'faux' } })).status, 401);
    const run = await env.fn('payouts', { headers: { 'x-cron-secret': CRON_SECRET() } });
    assert.deepEqual(run.body, { attempted: 1, paid: 1 });
    assert.equal((await sellerMm.c.rpc('seller_dashboard')).data.earnings[0].paidOutCents, 490000);

    const due = (await admin.c.rpc('admin_payouts_due')).data;
    assert.deepEqual(due.map((d) => [d.seller.name, d.amountCents, d.account.masked]), [['Vendeur Banque', 490000, '****0189']]);
    assert.equal((await rpcError(sellerBank.c.rpc('admin_payouts_due'))).code, '42501');
    await admin.c.rpc('admin_mark_bank_payout', { p_seller: sellerBank.id, p_currency: 'KMF', p_reference: 'VIR-001' });
    assert.equal((await admin.c.rpc('admin_payouts_due')).data.length, 0);

    // Litige : remboursement après versement → dette déduite des prochains gains.
    const refund = await env.fn('admin', { token: admin.token, body: { action: 'refund', orderId: r.body.order.id } });
    assert.equal(refund.status, 200, refund.text);
    const { rows } = await env.sql.query("select reason, net_cents from public.seller_earnings where seller_id = $1 order by reason desc", [sellerMm.id]);
    assert.deepEqual(rows, [{ reason: 'SALE', net_cents: 490000 }, { reason: 'REFUND', net_cents: -490000 }]);
    assert.equal((await buyer.c.rpc('my_library')).data.length, 0, 'accès retiré');
  });

  it('commission réglable par l’admin, livres de la plateforme sans commission', async () => {
    const admin = await env.admin();
    await enableMobileMoney(admin);
    assert.equal((await rpcError(admin.c.rpc('admin_put_settings', { p: { commissionPercent: 80 } }))).code, 'PT400');
    await admin.c.rpc('admin_put_settings', { p: { commissionPercent: 5 } });
    const seller = await env.register('Vendeur');
    const e = await listing(seller, { priceCents: 100000 });
    const platform = await env.ebook('Livre Folio');
    await env.sql.query("update public.ebooks set currency = 'KMF' where id = $1", [platform.id]);
    const buyer = await env.register('Acheteur');
    const r = await mmCheckout(buyer, [e.id, platform.id]);
    await phone(await session(r.body.order.id), 'succeeded');
    const { rows } = await env.sql.query('select commission_cents, net_cents from public.seller_earnings');
    assert.deepEqual(rows, [{ commission_cents: 5000, net_cents: 95000 }]);
  });
});
