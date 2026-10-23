// Versements Mobile Money automatiques aux vendeurs (appelée par pg_cron). Les virements bancaires
// sont faits à la main par l'admin. Désactivable sans redéploiement (réglage payoutsEnabled).
import { check, env, handler, HttpError, json, serviceClient } from '../_shared/http.ts';
import { decryptSecret } from '../_shared/crypto.ts';
import { mobileMoneyProvider } from '../_shared/mobile-money.ts';

Deno.serve(handler(async (req) => {
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) throw new HttpError(401, 'Non autorisé.');
  const db = serviceClient();
  const batch = check(await db.rpc('svc_prepare_mobile_money_payouts')) as
    { payoutId: string; amountCents: number; currency: string; country: string; operator: string; ciphertext: string }[];
  const mm = mobileMoneyProvider();
  let paid = 0;
  for (const p of batch) {
    let r: { ok: boolean; ref?: string; reason?: string };
    try {
      r = await mm.payout({ payoutId: p.payoutId, amountCents: p.amountCents, currency: p.currency, country: p.country, operator: p.operator, msisdn: await decryptSecret(p.ciphertext) });
    } catch (err) {
      r = { ok: false, reason: String(err) };
    }
    check(await db.rpc('svc_complete_payout', { p_payout: p.payoutId, p_ok: r.ok, p_ref: r.ref ?? null, p_reason: r.reason ?? null }));
    if (r.ok) paid++;
  }
  return json({ attempted: batch.length, paid });
}));
