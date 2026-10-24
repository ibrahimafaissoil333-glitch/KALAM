import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { CRON_SECRET, Env, rpcError } from './helpers.mjs';

// Faux service Expo Push (EXPO_PUSH_URL pointe ici en local) : capture les notifications envoyées.
describe('Notifications sur le téléphone', () => {
  let env, server;
  const received = [];
  before(async () => {
    env = await Env.start();
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const msgs = JSON.parse(raw);
        received.push(...msgs);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: msgs.map((m) => (m.to.includes('Desinstalle') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' })) }));
      });
    });
    await new Promise((r) => server.listen(54399, '0.0.0.0', r));
  });
  after(async () => {
    server.close();
    await env.stop();
  });
  beforeEach(async () => {
    received.length = 0;
    await env.reset();
  });

  const send = () => env.fn('send-emails', { headers: { 'x-cron-secret': CRON_SECRET() } });

  it('achat confirmé : notification avec la couverture du livre, sur chaque appareil du client', async () => {
    const buyer = await env.register('Acheteur');
    const e = await env.ebook('Le Grand Livre');
    await env.db.from('ebook_files').insert({ ebook_id: e.id, kind: 'COVER', storage_path: `${e.id}/cover.png`, mime_type: 'image/png', size_bytes: 10 });
    await buyer.c.rpc('register_push_token', { p_token: 'ExponentPushToken[telephone-1]', p_platform: 'ios' });
    await buyer.c.rpc('register_push_token', { p_token: 'ExponentPushToken[tablette-2]', p_platform: 'android' });
    await env.pay(buyer, [e.id]);
    const r = await send();
    assert.equal(r.status, 200, r.text);
    const mine = received.filter((m) => m.data.kind === 'order_confirmed');
    assert.deepEqual(mine.map((m) => m.to).sort(), ['ExponentPushToken[tablette-2]', 'ExponentPushToken[telephone-1]']);
    assert.match(mine[0].title, /confirmée/);
    assert.match(mine[0].richContent.image, new RegExp(`/covers/${e.id}/cover\\.png$`));
    assert.equal(mine[0].data.url, '/library');
    // Rien n'est renvoyé au passage suivant.
    received.length = 0;
    await send();
    assert.equal(received.length, 0);
  });

  it('sans couverture : visuel Kalam ; jeton désinstallé supprimé ; jeton invalide refusé', async () => {
    const buyer = await env.register('Acheteur');
    const e = await env.ebook();
    await env.sql.query("delete from public.ebook_files where ebook_id = $1 and kind = 'COVER'", [e.id]);
    await buyer.c.rpc('register_push_token', { p_token: 'ExponentPushToken[Desinstalle]' });
    assert.equal((await rpcError(buyer.c.rpc('register_push_token', { p_token: 'pas-un-jeton' }))).code, 'PT400');
    await env.pay(buyer, [e.id]);
    await send();
    // La première notification (bienvenue) part avec le visuel Kalam, puis le jeton désinstallé est supprimé.
    const [m] = received;
    assert.equal(m.data.kind, 'account_created');
    assert.match(m.richContent.image, /\/covers\/brand\/kalam\.png$/);
    assert.equal(received.filter((x) => x.data.kind === 'order_confirmed').length, 0, 'plus aucun envoi vers ce jeton');
    const { rows } = await env.sql.query('select count(*)::int n from public.push_tokens');
    assert.equal(rows[0].n, 0, 'jeton désinstallé supprimé');
  });
});
