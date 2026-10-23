// Téléphone simulé (développement uniquement) : POST /fake-mobile-money/<session>?outcome=succeeded|failed
// joue la confirmation ou le refus de l'acheteur, via un vrai callback signé.
import { env, handler, HttpError, json, serviceClient } from '../_shared/http.ts';
import { FakeMobileMoney, mobileMoneyProvider, simulateCallback } from '../_shared/mobile-money.ts';

Deno.serve(handler(async (req) => {
  const mm = mobileMoneyProvider();
  if (!(mm instanceof FakeMobileMoney) || env('FAKE_CHECKOUT_ENABLED', 'true') !== 'true') throw new HttpError(404, 'Introuvable.');
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const sessionId = parts[parts.indexOf('fake-mobile-money') + 1] ?? '';
  const outcome = new URL(req.url).searchParams.get('outcome');
  const { data: p } = await serviceClient().from('payments').select('provider_session_id, msisdn_last4').eq('provider_session_id', sessionId).eq('method', 'MOBILE_MONEY').maybeSingle();
  if (!p) throw new HttpError(404, 'Introuvable.');
  await simulateCallback(mm, sessionId, p.msisdn_last4, outcome === 'failed' ? 'FAILED' : outcome === 'succeeded' ? 'SUCCESS' : undefined);
  return json({ sent: true });
}));
