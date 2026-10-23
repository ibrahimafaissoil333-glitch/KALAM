// Crée une commande PENDING (prix figés) et une session de paiement. L'accès n'est PAS accordé ici.
import { check, env, handler, HttpError, json, serviceClient, userFromRequest } from '../_shared/http.ts';
import { provider, safeReturnUrl } from '../_shared/payments.ts';

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const { user } = await userFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const idem = req.headers.get('idempotency-key');
  if (idem && idem.length > 100) throw new HttpError(400, 'Idempotency-Key trop longue.');
  const ebookIds = Array.isArray(body.ebookIds) ? body.ebookIds.slice(0, 50) : [];
  const platform = ['ios', 'android', 'web'].includes(body.platform) ? body.platform : null;

  const db = serviceClient();
  const created = check(await db.rpc('svc_create_order', { p_user: user.id, p_ebooks: ebookIds, p_idem: idem, p_platform: platform })) as { orderId: string; existing: boolean };
  const order = check(await db.from('orders').select('*, order_items(*)').eq('id', created.orderId).single());
  const view = {
    id: order.id, reference: order.reference, status: order.status, totalCents: order.total_cents, currency: order.currency,
    createdAt: order.created_at, paidAt: order.paid_at,
    items: order.order_items.map((i: { ebook_id: string; title: string; price_cents: number }) => ({ ebookId: i.ebook_id, title: i.title, priceCents: i.price_cents })),
  };

  const pay = provider();
  if (created.existing) {
    // Double appui : même commande ; on rouvre la page de paiement si elle est toujours en attente.
    const { data: p } = await db.from('payments').select('provider_session_id').eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const url = order.status === 'PENDING' && p && pay.name === 'fake' ? `${env('PUBLIC_SUPABASE_URL', env('SUPABASE_URL'))}/functions/v1/fake-checkout/${p.provider_session_id}` : null;
    return json({ order: view, checkoutUrl: url });
  }

  const returnUrl = safeReturnUrl(body.returnUrl);
  const session = await pay.createSession({
    orderId: order.id, reference: order.reference, customerEmail: user.email ?? '', currency: order.currency,
    items: view.items.map((i: { title: string; priceCents: number }) => ({ title: i.title, priceCents: i.priceCents })), returnUrl,
  });
  check(await db.from('payments').insert({
    order_id: order.id, provider: pay.name, provider_session_id: session.sessionId, amount_cents: order.total_cents, currency: order.currency, return_url: returnUrl,
  }));
  return json({ order: view, checkoutUrl: session.url }, 201);
}));
