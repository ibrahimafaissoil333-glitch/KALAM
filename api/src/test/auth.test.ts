import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { PASSWORD, TestEnv, auth } from './helpers.js';

describe('Authentification', () => {
  let env: TestEnv;
  before(async () => (env = await TestEnv.start()));
  after(() => env.stop());
  beforeEach(() => env.reset());

  it('CA-08 : refuse un mot de passe sans chiffre', async () => {
    const res = await env.http.post('/v1/auth/register').send({ name: 'A', email: 'a@test.fr', password: 'abcdefgh', acceptTerms: true }).expect(400);
    assert.match(JSON.stringify(res.body.message), /une lettre et un chiffre/);
  });

  it("refuse l'inscription sans acceptation des conditions", async () => {
    await env.http.post('/v1/auth/register').send({ name: 'A', email: 'a@test.fr', password: PASSWORD, acceptTerms: false }).expect(400);
  });

  it("envoie l'e-mail de bienvenue et refuse un e-mail en double", async () => {
    await env.register('Sarah', 'sarah@test.fr');
    assert.equal(env.mail.outbox.filter((m) => m.kind === 'account_created').length, 1);
    await env.http.post('/v1/auth/register').send({ name: 'B', email: 'SARAH@test.fr', password: PASSWORD, acceptTerms: true }).expect(409);
  });

  it('CA-09 : message générique sur mauvais mot de passe ou compte inconnu', async () => {
    await env.register('Sarah', 'sarah@test.fr');
    const a = await env.http.post('/v1/auth/login').send({ email: 'sarah@test.fr', password: 'mauvais123' }).expect(401);
    const b = await env.http.post('/v1/auth/login').send({ email: 'inconnu@test.fr', password: 'mauvais123' }).expect(401);
    assert.equal(a.body.message, 'E-mail ou mot de passe incorrect.');
    assert.equal(a.body.message, b.body.message);
  });

  it('CA-10 : verrouille après 5 échecs', async () => {
    await env.register('Sarah', 'sarah@test.fr');
    for (let i = 0; i < 5; i++) await env.http.post('/v1/auth/login').send({ email: 'sarah@test.fr', password: 'mauvais123' }).expect(401);
    await env.http.post('/v1/auth/login').send({ email: 'sarah@test.fr', password: PASSWORD }).expect(429);
  });

  it('rotation du jeton de rafraîchissement et détection de réutilisation', async () => {
    const u = await env.register();
    const r1 = await env.http.post('/v1/auth/refresh').send({ refreshToken: u.refresh }).expect(200);
    // Réutiliser l'ancien jeton révoque toute la famille, y compris le nouveau.
    await env.http.post('/v1/auth/refresh').send({ refreshToken: u.refresh }).expect(401);
    await env.http.post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
  });

  it('CA-11 / CA-12 : réinitialisation par lien à usage unique', async () => {
    await env.register('Sarah', 'sarah@test.fr');
    const same1 = await env.http.post('/v1/auth/forgot-password').send({ email: 'sarah@test.fr' }).expect(202);
    const same2 = await env.http.post('/v1/auth/forgot-password').send({ email: 'personne@test.fr' }).expect(202);
    assert.deepEqual(same1.body, same2.body);
    const mail = env.mail.outbox.find((m) => m.kind === 'password_reset');
    const token = mail!.text.match(/token=([\w-]+)/)![1];
    await env.http.post('/v1/auth/reset-password').send({ token, password: 'nouveau123' }).expect(204);
    await env.http.post('/v1/auth/reset-password').send({ token, password: 'encore1234' }).expect(400);
    await env.http.post('/v1/auth/login').send({ email: 'sarah@test.fr', password: 'nouveau123' }).expect(200);
  });

  it('un compte suspendu perd immédiatement l’accès', async () => {
    const u = await env.register();
    await env.http.get('/v1/me').set(auth(u.token)).expect(200);
    await env.prisma.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
    await env.http.get('/v1/me').set(auth(u.token)).expect(401);
  });

  it('limite le nombre d’appareils quand le paramètre est défini', async () => {
    await env.prisma.setting.create({ data: { key: 'app', value: { maxDevices: 1 } } });
    await env.register('Sarah', 'sarah@test.fr');
    const login = (deviceKey: string) => env.http.post('/v1/auth/login').send({ email: 'sarah@test.fr', password: PASSWORD, deviceKey, platform: 'ios' });
    await login('appareil-1').expect(200);
    await login('appareil-1').expect(200);
    await login('appareil-2').expect(409);
  });
});
