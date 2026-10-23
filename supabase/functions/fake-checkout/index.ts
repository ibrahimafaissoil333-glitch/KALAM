// Page de paiement simulée (développement uniquement) : envoie un vrai webhook signé, comme un prestataire.
import { env, handler, HttpError, serviceClient } from '../_shared/http.ts';
import { FakeProvider, provider } from '../_shared/payments.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

Deno.serve(handler(async (req) => {
  const pay = provider();
  if (!(pay instanceof FakeProvider) || env('FAKE_CHECKOUT_ENABLED', 'true') !== 'true') throw new HttpError(404, 'Introuvable.');
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const i = parts.indexOf('fake-checkout');
  const sessionId = parts[i + 1];
  const action = parts[i + 2];
  const db = serviceClient();
  const { data: p } = await db.from('payments').select('*, orders(*, order_items(*))').eq('provider_session_id', sessionId ?? '').maybeSingle();
  if (!p) throw new HttpError(404, 'Introuvable.');
  const fmt = (c: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: p.currency }).format(c / 100);

  if (req.method === 'POST' && action === 'complete') {
    const outcome = new URL(req.url).searchParams.get('outcome');
    if (outcome === 'succeeded' || outcome === 'failed') {
      const body = JSON.stringify({
        id: `evt_${crypto.randomUUID()}`,
        type: outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
        sessionId,
        paymentId: outcome === 'succeeded' ? `fake_pi_${crypto.randomUUID()}` : undefined,
        reason: outcome === 'failed' ? 'card_declined' : undefined,
      });
      // Envoyé par HTTP à la fonction webhook, exactement comme le ferait un vrai prestataire.
      await fetch(`${env('SUPABASE_URL')}/functions/v1/payment-webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fake-signature': await pay.sign(body) },
        body,
      });
    }
    const ret = p.return_url ?? env('CHECKOUT_RETURN_URL', 'folio://checkout/return');
    const sep = ret.includes('?') ? '&' : '?';
    return new Response(null, { status: 303, headers: { location: `${ret}${sep}order=${p.order_id}&result=${outcome === 'abandon' ? 'cancel' : 'success'}` } });
  }

  const o = p.orders;
  const lines = o.order_items.map((it: { title: string; price_cents: number }) => `<li><span>${esc(it.title)}</span><b>${fmt(it.price_cents)}</b></li>`).join('');
  const action_ = (outcome: string) => `/functions/v1/fake-checkout/${esc(sessionId)}/complete?outcome=${outcome}`;
  const done = o.status !== 'PENDING';
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement de test</title><style>
body{margin:0;font-family:system-ui,sans-serif;background:#FAFAF7;color:#14151F;display:flex;justify-content:center}
main{max-width:420px;width:100%;padding:32px 20px;display:flex;flex-direction:column;gap:16px}
.warn{background:#FFF0D2;color:#7A4E00;border-radius:12px;padding:12px 14px;font-size:14px;font-weight:600}
ul{list-style:none;padding:0;margin:0;background:#fff;border:1px solid #E6E5E0;border-radius:16px}
li{display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #ECEBE6}
.total{font-weight:700;font-size:18px;display:flex;justify-content:space-between}
button{min-height:52px;border-radius:14px;border:0;font-size:16px;font-weight:600;cursor:pointer;width:100%}
.ok{background:#3B36E0;color:#fff}.ko{background:transparent;border:1.5px solid #D6D5CF;color:#14151F}
</style></head><body><main><div class="warn">Prestataire de test : aucun paiement réel n'est effectué.</div>
<h1 style="margin:0;font-size:26px">Commande ${esc(o.reference)}</h1><ul>${lines}</ul><div class="total"><span>Total</span><span>${fmt(p.amount_cents)}</span></div>
${done ? `<p>Cette commande est déjà traitée (${o.status}).</p>` : `
<form method="post" action="${action_('succeeded')}"><button class="ok">Payer ${fmt(p.amount_cents)}</button></form>
<form method="post" action="${action_('failed')}"><button class="ko">Simuler un refus de carte</button></form>
<form method="post" action="${action_('abandon')}"><button class="ko">Fermer sans payer</button></form>`}
</main></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}));
