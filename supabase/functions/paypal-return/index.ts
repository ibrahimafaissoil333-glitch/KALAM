// Retour de la page PayPal (PayPal n'accepte que des adresses https) : capture immédiate du paiement validé,
// puis redirection vers l'app. Le webhook PayPal reste la confirmation de secours (traitement idempotent).
import { check, env, handler, serviceClient } from '../_shared/http.ts';
import { PayPalProvider, paypalProvider } from '../_shared/payments.ts';

Deno.serve(handler(async (req) => {
  const url = new URL(req.url);
  const orderId = url.searchParams.get('order') ?? '';
  const result = url.searchParams.get('result') === 'success' ? 'success' : 'cancel';
  const db = serviceClient();
  const { data: pay } = await db.from('payments').select('provider, provider_session_id, return_url').eq('order_id', orderId).eq('method', 'PAYPAL')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const pp = paypalProvider();
  if (pay && result === 'success' && pp instanceof PayPalProvider) {
    try {
      const c = await pp.capture(pay.provider_session_id);
      const event = `return_${pay.provider_session_id}`;
      if (c.outcome !== 'ignored' && check(await db.rpc('svc_record_event', { p_provider: pp.name, p_event: event, p_type: 'paypal.return', p_outcome: c.outcome }))) {
        if (c.outcome === 'succeeded') check(await db.rpc('svc_mark_paid', { p_provider: pp.name, p_event: event, p_session: pay.provider_session_id, p_payment_ref: c.paymentId ?? null, p_tax: null, p_country: null }));
        else check(await db.rpc('svc_mark_failed', { p_provider: pp.name, p_event: event, p_session: pay.provider_session_id, p_reason: 'Paiement PayPal refusé' }));
      }
    } catch (err) {
      console.error(err); // le webhook prendra le relais
    }
  }
  const back = pay?.return_url ?? env('CHECKOUT_RETURN_URL', 'folio://checkout/return');
  const sep = back.includes('?') ? '&' : '?';
  return new Response(null, { status: 303, headers: { location: `${back}${sep}order=${encodeURIComponent(orderId)}&result=${result}` } });
}));
