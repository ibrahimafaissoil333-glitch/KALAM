import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { anon, buildEpub } from './lib.mjs';
import { Env, PASSWORD } from './helpers.mjs';

describe('Sécurité et administration', () => {
  let env;
  before(async () => (env = await Env.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  it("CA-19 : un client ne peut pas accéder au contenu ni aux données d'un autre compte", async () => {
    const e = await env.ebook();
    const alice = await env.register('Alice');
    const bob = await env.register('Bob');
    const o = await env.pay(alice, [e.id]);

    assert.equal((await env.fn('library', { token: bob.token, body: { action: 'content', ebookId: e.id } })).status, 403);
    assert.equal((await env.fn('library', { token: bob.token, body: { action: 'download', ebookId: e.id } })).status, 403);
    assert.ok((await bob.c.rpc('save_progress', { p_ebook: e.id, p_chapter: 0, p_block: 0, p_percent: 1 })).error);
    assert.ok((await bob.c.rpc('my_order', { p_id: o.orderId })).error);
    // Lecture directe des tables : RLS ne renvoie rien.
    assert.equal((await bob.c.from('orders').select('id')).data.length, 0);
    assert.equal((await bob.c.from('entitlements').select('id')).data.length, 0);
    assert.equal((await bob.c.from('payments').select('id')).data.length, 0);
    // Le stockage privé est inaccessible en direct, même pour l'acheteuse.
    const { data: files } = await env.db.from('ebook_files').select('storage_path').eq('ebook_id', e.id).eq('kind', 'MAIN');
    assert.ok((await bob.c.storage.from('ebooks').download(files[0].storage_path)).error);
    assert.ok((await alice.c.storage.from('ebooks').download(files[0].storage_path)).error);
    assert.ok((await anon().storage.from('ebooks').createSignedUrl(files[0].storage_path, 60)).error);
  });

  it('CA-20 : URL signée valable, refusée si falsifiée', async () => {
    const e = await env.ebook();
    const u = await env.register();
    await env.pay(u, [e.id]);
    const r = await env.fn('library', { token: u.token, body: { action: 'download', ebookId: e.id } });
    assert.equal(r.status, 200);
    assert.equal((await fetch(r.body.url)).status, 200);
    const forged = r.body.url.replace(/token=([^&]+)/, (_, t) => `token=${t.slice(0, -4)}AAAA`);
    assert.notEqual((await fetch(forged)).status, 200);
  });

  it('téléchargement refusé si non autorisé, limite appliquée', async () => {
    const locked = await env.ebook('Verrouillé', { downloadAllowed: false });
    const open = await env.ebook('Ouvert');
    const u = await env.register();
    await env.pay(u, [locked.id, open.id]);
    assert.equal((await env.fn('library', { token: u.token, body: { action: 'download', ebookId: locked.id } })).status, 403);
    await env.sql.query(`insert into public.settings (key, value) values ('app', '{"maxDownloadsPerBook": 1}')`);
    assert.equal((await env.fn('library', { token: u.token, body: { action: 'download', ebookId: open.id } })).status, 200);
    assert.equal((await env.fn('library', { token: u.token, body: { action: 'download', ebookId: open.id } })).status, 429);
  });

  it('CA-22 : un remboursement retire l’accès', async () => {
    const e = await env.ebook();
    const u = await env.register();
    const admin = await env.admin();
    const o = await env.pay(u, [e.id]);
    const r = await env.fn('admin', { token: admin.token, body: { action: 'refund', orderId: o.orderId } });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'REFUNDED');
    assert.equal((await u.c.rpc('my_library')).data.length, 0);
    assert.equal((await env.fn('library', { token: u.token, body: { action: 'content', ebookId: e.id } })).status, 403);
    assert.equal((await env.outbox('order_refunded')).length, 1);
  });

  it('CA-23 : un client ne peut pas utiliser les fonctions admin', async () => {
    const u = await env.register();
    assert.match((await u.c.rpc('admin_orders', {})).error.message, /Accès refusé/);
    assert.match((await u.c.rpc('admin_stats', {})).error.message, /Accès refusé/);
    assert.ok((await u.c.rpc('admin_save_ebook', { p_id: null, p: { title: 'x', author: 'y' } })).error);
    assert.equal((await env.fn('admin', { token: u.token, body: { action: 'refund', orderId: '00000000-0000-0000-0000-000000000000' } })).status, 403);
    assert.ok((await anon().rpc('admin_orders', {})).error);
  });

  it('résiste à une injection dans la recherche', async () => {
    await env.ebook();
    const r = await anon().rpc('search_ebooks', { p_q: "'; DROP TABLE ebooks; --" });
    assert.equal(r.data.total, 0);
    assert.equal((await env.sql.query('select count(*)::int n from public.ebooks')).rows[0].n, 1);
  });

  it('CA-24 / CA-27 : création, envoi EPUB, publication et journal', async () => {
    const admin = await env.admin();
    const created = (await admin.c.rpc('admin_save_ebook', { p_id: null, p: { title: 'Nouveau livre', author: 'Auteur', category: 'Roman', description: 'Texte' } })).data;
    assert.deepEqual([...created.publishable].sort(), ['Contenu lisible non extrait (EPUB requis pour la lecture dans l’app)', 'Fichier principal manquant', 'Prix à définir'].sort());
    assert.match((await admin.c.rpc('admin_set_ebook_status', { p_id: created.id, p_action: 'publish' })).error.message, /Publication impossible/);
    await admin.c.rpc('admin_save_ebook', { p_id: created.id, p: { priceCents: 990 } });

    const epub = await buildEpub({ title: 'Nouveau livre', author: 'Auteur', chapters: [{ title: 'Ch 1', paragraphs: ['Bonjour'] }] });
    const form = new FormData();
    form.set('ebookId', created.id);
    form.set('kind', 'main');
    form.set('file', new Blob([epub], { type: 'application/epub+zip' }), 'livre.epub');
    const up = await env.fn('admin', { token: admin.token, form });
    assert.equal(up.status, 200, up.text);
    assert.deepEqual(up.body.publishable, []);
    const bad = new FormData();
    bad.set('ebookId', created.id);
    bad.set('kind', 'main');
    bad.set('file', new Blob(['pas un epub'], { type: 'application/epub+zip' }), 'x.epub');
    assert.equal((await env.fn('admin', { token: admin.token, form: bad })).status, 400);

    assert.equal((await admin.c.rpc('admin_set_ebook_status', { p_id: created.id, p_action: 'publish' })).error, null);
    assert.equal((await anon().rpc('search_ebooks', {})).data.items[0].title, 'Nouveau livre');
    const actions = (await env.sql.query('select action from public.audit_logs')).rows.map((r) => r.action);
    for (const a of ['ebook.create', 'ebook.price', 'ebook.upload.main', 'ebook.publish']) assert.ok(actions.includes(a), a);
  });

  it('CA-26 : le chiffre d’affaires exclut les remboursements', async () => {
    const [a, b] = [await env.ebook('A', { priceCents: 1000 }), await env.ebook('B', { priceCents: 500 })];
    const admin = await env.admin();
    const u = await env.register();
    await env.pay(u, [a.id]);
    const refunded = await env.pay(u, [b.id]);
    await env.fn('admin', { token: admin.token, body: { action: 'refund', orderId: refunded.orderId } });
    const stats = (await admin.c.rpc('admin_stats', { p_period: '30d' })).data;
    assert.equal(stats.revenueCents, 1000);
    assert.equal(stats.paidOrders, 1);
  });

  it('RGPD : export puis suppression du compte, commandes conservées', async () => {
    const e = await env.ebook();
    const u = await env.register('Sarah', 'sarah@test.fr');
    await env.pay(u, [e.id]);
    assert.equal((await u.c.rpc('my_export')).data.orders.length, 1);
    assert.equal((await env.fn('account', { token: u.token, body: { action: 'delete', password: 'mauvais' } })).status, 400);
    assert.equal((await env.fn('account', { token: u.token, body: { action: 'delete', password: PASSWORD } })).status, 204);
    const { rows } = await env.sql.query('select email, status from public.profiles where id = $1', [u.id]);
    assert.deepEqual(rows[0], { email: null, status: 'DELETED' });
    assert.equal((await env.sql.query('select count(*)::int n from public.orders where user_id = $1', [u.id])).rows[0].n, 1);
    assert.ok((await anon().auth.signInWithPassword({ email: 'sarah@test.fr', password: PASSWORD })).error);
  });
});
