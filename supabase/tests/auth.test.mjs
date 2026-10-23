import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { anon } from './lib.mjs';
import { Env, PASSWORD, rpcError } from './helpers.mjs';

describe('Comptes (Supabase Auth)', () => {
  let env;
  before(async () => (env = await Env.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  it('CA-08 : refuse un mot de passe sans chiffre', async () => {
    const { error } = await anon().auth.signUp({ email: 'a@test.fr', password: 'abcdefgh', options: { data: { name: 'A', accept_terms: true } } });
    assert.ok(error, 'le mot de passe faible doit être refusé');
  });

  it("refuse l'inscription sans acceptation des conditions", async () => {
    const { error } = await anon().auth.signUp({ email: 'a@test.fr', password: PASSWORD, options: { data: { name: 'A' } } });
    assert.ok(error);
    const { rows } = await env.sql.query('select count(*)::int n from auth.users');
    assert.equal(rows[0].n, 0);
  });

  it("crée le profil, met en file l'e-mail de bienvenue", async () => {
    const u = await env.register('Sarah', 'sarah@test.fr', { marketing_consent: true });
    const { data: me } = await u.c.rpc('me');
    assert.equal(me.name, 'Sarah');
    assert.equal(me.role, 'CUSTOMER');
    assert.equal((await env.outbox('account_created')).length, 1);
    const { rows } = await env.sql.query('select marketing_consent, marketing_consent_at is not null as dated from public.profiles where id = $1', [u.id]);
    assert.deepEqual(rows[0], { marketing_consent: true, dated: true });
  });

  it('CA-09 : connexion refusée avec un message générique', async () => {
    await env.register('Sarah', 'sarah@test.fr');
    const a = await anon().auth.signInWithPassword({ email: 'sarah@test.fr', password: 'mauvais123' });
    const b = await anon().auth.signInWithPassword({ email: 'inconnu@test.fr', password: 'mauvais123' });
    assert.ok(a.error && b.error);
    assert.equal(a.error.message, b.error.message);
  });

  it('CA-11 : réponse identique à la demande de réinitialisation, compte existant ou non', async () => {
    await env.register('Sarah', 'sarah@test.fr');
    const a = await anon().auth.resetPasswordForEmail('sarah@test.fr', { redirectTo: 'folio://reset' });
    const b = await anon().auth.resetPasswordForEmail('personne@test.fr', { redirectTo: 'folio://reset' });
    assert.equal(a.error, null);
    assert.equal(b.error, null);
  });

  it('un compte suspendu perd immédiatement l’accès', async () => {
    const u = await env.register();
    assert.equal((await u.c.rpc('cart_get')).error, null);
    await env.sql.query(`update public.profiles set status = 'SUSPENDED' where id = $1`, [u.id]);
    const err = await rpcError(u.c.rpc('cart_get'));
    assert.match(err.message, /inactif/);
  });

  it('limite le nombre d’appareils quand le paramètre est défini', async () => {
    await env.sql.query(`insert into public.settings (key, value) values ('app', '{"maxDevices": 1}')`);
    const u = await env.register();
    assert.equal((await u.c.rpc('register_device', { p_key: 'a1', p_label: 'iPhone', p_platform: 'ios' })).error, null);
    assert.equal((await u.c.rpc('register_device', { p_key: 'a1', p_label: 'iPhone', p_platform: 'ios' })).error, null);
    const err = await rpcError(u.c.rpc('register_device', { p_key: 'a2', p_label: 'iPad', p_platform: 'ios' }));
    assert.match(err.message, /Nombre maximal/);
  });

  it("un client ne peut pas s'attribuer le rôle admin", async () => {
    const u = await env.register();
    await u.c.from('profiles').update({ role: 'ADMIN' }).eq('id', u.id);
    await u.c.auth.updateUser({ data: { role: 'ADMIN' } });
    const { rows } = await env.sql.query('select role from public.profiles where id = $1', [u.id]);
    assert.equal(rows[0].role, 'CUSTOMER');
    assert.equal((await u.c.rpc('is_admin')).data, false);
  });
});
