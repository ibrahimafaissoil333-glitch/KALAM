import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { anon } from './lib.mjs';
import { Env, rpcError } from './helpers.mjs';

describe('Carrousel publicitaire de l’accueil', () => {
  let env;
  before(async () => (env = await Env.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  it('l’admin met n’importe quel livre en avant ; l’accueil n’affiche que les diapositives actives et publiées', async () => {
    const admin = await env.admin();
    const a = await env.ebook('Livre A');
    const b = await env.ebook('Livre B');
    const draft = await env.ebook('Brouillon', { status: 'DRAFT' });
    const s1 = (await admin.c.rpc('admin_save_promo_slide', { p_id: null, p: { ebookId: a.id, headline: 'Le roman de l’été' } })).data;
    const s2 = (await admin.c.rpc('admin_save_promo_slide', { p_id: null, p: { ebookId: b.id } })).data;
    await admin.c.rpc('admin_save_promo_slide', { p_id: null, p: { ebookId: draft.id } });
    await admin.c.rpc('admin_save_promo_slide', { p_id: null, p: { ebookId: a.id, endsAt: new Date(Date.now() - 1000).toISOString(), startsAt: new Date(Date.now() - 5000).toISOString() } });

    let home = (await anon().rpc('catalog_home')).data;
    assert.deepEqual(home.slides.map((s) => [s.ebook.title, s.headline]), [['Livre A', 'Le roman de l’été'], ['Livre B', null]]);

    await admin.c.rpc('admin_move_promo_slide', { p_id: s2.id, p_dir: -1 });
    await admin.c.rpc('admin_save_promo_slide', { p_id: s1.id, p: { active: false } });
    home = (await anon().rpc('catalog_home')).data;
    assert.deepEqual(home.slides.map((s) => s.ebook.title), ['Livre B']);
    assert.equal((await admin.c.rpc('admin_promo_slides')).data.length, 4);

    const del = await env.fn('admin', { token: admin.token, body: { action: 'delete-promo-slide', slideId: s2.id } });
    assert.equal(del.status, 200, del.text);
    assert.equal((await anon().rpc('catalog_home')).data.slides.length, 0);
  });

  it('réservé aux admins, avec validation', async () => {
    const admin = await env.admin();
    const user = await env.register('Client');
    const e = await env.ebook();
    assert.equal((await rpcError(user.c.rpc('admin_save_promo_slide', { p_id: null, p: { ebookId: e.id } }))).code, '42501');
    assert.equal((await rpcError(user.c.rpc('admin_promo_slides'))).code, '42501');
    assert.equal((await user.c.from('promo_slides').select('*')).data.length, 0);
    assert.equal((await rpcError(admin.c.rpc('admin_save_promo_slide', { p_id: null, p: {} }))).code, 'PT400');
    assert.equal((await rpcError(admin.c.rpc('admin_save_promo_slide', { p_id: null, p: { ebookId: e.id, headline: 'x'.repeat(81) } }))).code, 'PT400');
    const form = new FormData();
    form.set('kind', 'promo-video');
    form.set('slideId', '00000000-0000-0000-0000-000000000000');
    form.set('file', new Blob(['x'], { type: 'video/mp4' }), 'v.mp4');
    assert.equal((await env.fn('admin', { token: user.token, form })).status, 403);
  });

  it('vidéo de diapositive : envoyée par l’admin, lisible publiquement, remplacée puis retirée', async () => {
    const admin = await env.admin();
    const e = await env.ebook();
    const slide = (await admin.c.rpc('admin_save_promo_slide', { p_id: null, p: { ebookId: e.id } })).data;
    const send = (type) => {
      const form = new FormData();
      form.set('kind', 'promo-video');
      form.set('slideId', slide.id);
      form.set('file', new Blob([new Uint8Array(64)], { type }), 'pub.mp4');
      return env.fn('admin', { token: admin.token, form });
    };
    assert.equal((await send('image/png')).status, 400);
    const up = await send('video/mp4');
    assert.equal(up.status, 200, up.text);
    const path = up.body[0].videoPath;
    assert.match(path, /^.+\/video-\d+\.mp4$/);
    assert.equal((await anon().rpc('catalog_home')).data.slides[0].videoPath, path);
    const second = (await send('video/mp4')).body[0].videoPath;
    const { data: files } = await env.db.storage.from('promos').list(slide.id);
    assert.deepEqual(files.map((f) => `${slide.id}/${f.name}`), [second], 'l’ancienne vidéo est effacée');
    const removed = await env.fn('admin', { token: admin.token, body: { action: 'remove-promo-video', slideId: slide.id } });
    assert.equal(removed.body[0].videoPath, null);
  });
});
