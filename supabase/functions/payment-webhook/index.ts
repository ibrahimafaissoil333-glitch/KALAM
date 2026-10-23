// Webhook du prestataire : SEULE source de confirmation de paiement. Signature vérifiée, idempotent.
import { check, handler, HttpError, json, serviceClient } from '../_shared/http.ts';
import { InvalidSignature, provider } from '../_shared/payments.ts';

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const raw = await req.text();
  const pay = provider();
  let ev;
  try {
    ev = await pay.parseWebhook(raw, req.headers);
  } catch (err) {
    if (err instanceof InvalidSignature) {
      console.warn(`Webhook rejeté : ${err.message}`);
      throw new HttpError(400, 'Signature invalide.');
    }
    throw err;
  }
  const db = serviceClient();
  const fresh = check(await db.rpc('svc_record_event', { p_provider: pay.name, p_event: ev.eventId, p_type: ev.type, p_outcome: ev.outcome }));
  if (!fresh) return json({ received: true, result: 'duplicate' });
  if (ev.outcome === 'ignored') return json({ received: true, result: 'ignored' });

  let result: string;
  if (ev.outcome === 'succeeded') {
    result = check(await db.rpc('svc_mark_paid', { p_provider: pay.name, p_event: ev.eventId, p_session: ev.sessionId, p_payment_ref: ev.paymentId ?? null, p_tax: ev.taxCents ?? null, p_country: ev.taxCountry ?? null })) as string;
  } else if (ev.outcome === 'failed') {
    result = check(await db.rpc('svc_mark_failed', { p_provider: pay.name, p_event: ev.eventId, p_session: ev.sessionId, p_reason: ev.reason ?? null })) as string;
  } else {
    result = check(await db.rpc('svc_mark_refunded_by_payment', { p_provider: pay.name, p_event: ev.eventId, p_payment_ref: ev.paymentId })) as string;
  }
  return json({ received: true, result });
}));
