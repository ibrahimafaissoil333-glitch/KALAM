// Statut d'une commande pour l'écran « Confirmez sur votre téléphone » (interrogé toutes les quelques secondes).
// En simulation, la confirmation de l'acheteur est jouée automatiquement après FAKE_MM_AUTO_CONFIRM_SECONDS.
import { check, env, handler, HttpError, json, serviceClient, userFromRequest } from '../_shared/http.ts';
import { FakeMobileMoney, mobileMoneyProvider, simulateCallback } from '../_shared/mobile-money.ts';
import { PayPalProvider, paypalProvider } from '../_shared/payments.ts';

Deno.serve(handler(async (req) => {
  const { user } = await userFromRequest(req);
  const orderId = new URL(req.url).searchParams.get('order') ?? (await req.json().catch(() => ({}))).orderId;
  if (typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orderId)) throw new HttpError(400, 'Commande invalide.');
  const db = serviceClient();
  const { data: order } = await db.from('orders').select('id, reference, status, payment_method, user_id, created_at').eq('id', orderId).maybeSingle();
  if (!order || order.user_id !== user.id) throw new HttpError(404, 'Commande introuvable.');
  const { data: pay } = await db.from('payments').select('*').eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

  let status = order.status as string;
  if (status === 'PENDING' && pay?.method === 'MOBILE_MONEY') {
    const mm = mobileMoneyProvider();
    const age = (Date.now() - new Date(pay.created_at).getTime()) / 1000;
    const delay = Number(env('FAKE_MM_AUTO_CONFIRM_SECONDS', '-1'));
    if (mm instanceof FakeMobileMoney && delay >= 0 && age >= delay) {
      await simulateCallback(mm, pay.provider_session_id, pay.msisdn_last4);
    } else if (!(mm instanceof FakeMobileMoney)) {
      // Filet de sécurité si le callback de l'opérateur se fait attendre : on interroge son API.
      const s = await mm.getStatus(pay.provider_session_id);
      if (s !== 'pending') {
        const event = `poll_${pay.provider_session_id}`;
        const fresh = check(await db.rpc('svc_record_event', { p_provider: mm.name, p_event: event, p_type: `mobile_money.poll.${s}`, p_outcome: s }));
        if (fresh && s === 'succeeded') check(await db.rpc('svc_mark_paid', { p_provider: mm.name, p_event: event, p_session: pay.provider_session_id, p_payment_ref: null, p_tax: null, p_country: null }));
        if (fresh && s === 'failed') check(await db.rpc('svc_mark_failed', { p_provider: mm.name, p_event: event, p_session: pay.provider_session_id, p_reason: 'Refusé par l’opérateur' }));
      }
    }
    status = check(await db.from('orders').select('status').eq('id', order.id).single()).status;
  }
  // PayPal validé mais pas encore capturé (retour interrompu, webhook en retard) : capture ici.
  const pp = status === 'PENDING' && pay?.method === 'PAYPAL' ? await paypalProvider() : null;
  if (pp instanceof PayPalProvider && (await pp.orderStatus(pay.provider_session_id).catch(() => '')) === 'APPROVED') {
    const c = await pp.capture(pay.provider_session_id);
    const event = `poll_${pay.provider_session_id}`;
    if (c.outcome === 'succeeded' && check(await db.rpc('svc_record_event', { p_provider: pp.name, p_event: event, p_type: 'paypal.poll', p_outcome: c.outcome }))) {
      check(await db.rpc('svc_mark_paid', { p_provider: pp.name, p_event: event, p_session: pay.provider_session_id, p_payment_ref: c.paymentId ?? null, p_tax: null, p_country: null }));
      status = 'PAID';
    }
  }
  return json({
    orderId: order.id, reference: order.reference, status, paymentMethod: order.payment_method,
    failureReason: status === 'FAILED' ? pay?.failure_reason ?? null : null,
    mobileMoney: pay?.method === 'MOBILE_MONEY' ? { operator: pay.operator, masked: `****${pay.msisdn_last4}` } : null,
  });
}));
