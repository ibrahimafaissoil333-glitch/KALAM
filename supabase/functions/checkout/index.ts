// Crée une commande PENDING (prix figés, stock réservé) et lance le paiement : session carte,
// ou demande Mobile Money envoyée sur le téléphone de l'acheteur. L'accès n'est PAS accordé ici.
import { check, env, handler, HttpError, json, serviceClient, userFromRequest } from '../_shared/http.ts';
import { provider, safeReturnUrl } from '../_shared/payments.ts';
import { maskMsisdn, mobileMoneyProvider, normalizeMsisdn } from '../_shared/mobile-money.ts';

const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const { user } = await userFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const idem = req.headers.get('idempotency-key');
  if (idem && idem.length > 100) throw new HttpError(400, 'Idempotency-Key trop longue.');
  const ebookIds = Array.isArray(body.ebookIds) ? body.ebookIds.filter((x: unknown) => typeof x === 'string' && UUID.test(x)).slice(0, 50) : [];
  const platform = ['ios', 'android', 'web'].includes(body.platform) ? body.platform : null;
  const method = body.paymentMethod === 'MOBILE_MONEY' ? 'MOBILE_MONEY' : 'CARD';
  const shipping: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.shipping ?? {})) if (UUID.test(k) && typeof v === 'string' && UUID.test(v)) shipping[k] = v;
  const addressId = typeof body.addressId === 'string' && UUID.test(body.addressId) ? body.addressId : null;

  let mm: { country: string; operator: string; msisdn: string } | null = null;
  if (method === 'MOBILE_MONEY') {
    const country = String(body.mobileMoney?.country ?? '').toUpperCase();
    const operator = String(body.mobileMoney?.operator ?? '').toUpperCase();
    const msisdn = normalizeMsisdn(country, body.mobileMoney?.phone);
    if (!msisdn) throw new HttpError(400, 'Numéro Mobile Money invalide pour ce pays.');
    mm = { country, operator, msisdn };
  }

  const db = serviceClient();
  const created = check(await db.rpc('svc_create_order', {
    p_user: user.id, p_ebooks: ebookIds, p_idem: idem, p_platform: platform, p_shipping: shipping, p_address_id: addressId,
    p_method: method, p_mm_country: mm?.country ?? null, p_mm_operator: mm?.operator ?? null,
  })) as { orderId: string; existing: boolean };
  const order = check(await db.from('orders').select('*, order_items(*)').eq('id', created.orderId).single());
  const view = {
    id: order.id, reference: order.reference, status: order.status, totalCents: order.total_cents, currency: order.currency,
    createdAt: order.created_at, paidAt: order.paid_at, paymentMethod: order.payment_method,
    items: order.order_items.map((i: { ebook_id: string; title: string; price_cents: number; kind: string; shipping_cents: number }) =>
      ({ ebookId: i.ebook_id, title: i.title, priceCents: i.price_cents, kind: i.kind, shippingCents: i.shipping_cents })),
  };

  if (created.existing) {
    // Double appui : même commande ; on rouvre la page de paiement si elle est toujours en attente.
    const { data: p } = await db.from('payments').select('provider, provider_session_id, operator, msisdn_last4').eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (order.payment_method === 'MOBILE_MONEY') {
      return json({ order: view, checkoutUrl: null, mobileMoney: p ? { operator: p.operator, masked: `****${p.msisdn_last4}` } : null });
    }
    const url = order.status === 'PENDING' && p && p.provider === 'fake' ? `${env('PUBLIC_SUPABASE_URL', env('SUPABASE_URL'))}/functions/v1/fake-checkout/${p.provider_session_id}` : null;
    return json({ order: view, checkoutUrl: url });
  }

  if (mm) {
    const mmp = mobileMoneyProvider();
    let session;
    try {
      session = await mmp.initiate({ orderId: order.id, reference: order.reference, amountCents: order.total_cents, currency: order.currency, ...mm });
    } catch (err) {
      console.error(err);
      check(await db.rpc('svc_abort_order', { p_order: order.id }));
      throw new HttpError(502, 'L’opérateur Mobile Money ne répond pas. Réessayez dans quelques instants.');
    }
    check(await db.from('payments').insert({
      order_id: order.id, provider: mmp.name, provider_session_id: session.sessionId, amount_cents: order.total_cents, currency: order.currency,
      method: 'MOBILE_MONEY', country: mm.country, operator: mm.operator, msisdn_last4: mm.msisdn.slice(-4),
    }));
    return json({ order: view, checkoutUrl: null, mobileMoney: { operator: mm.operator, masked: maskMsisdn(mm.msisdn) } }, 201);
  }

  const pay = provider();
  const returnUrl = safeReturnUrl(body.returnUrl);
  const session = await pay.createSession({
    orderId: order.id, reference: order.reference, customerEmail: user.email ?? '', currency: order.currency,
    items: [
      ...view.items.map((i: { title: string; priceCents: number }) => ({ title: i.title, priceCents: i.priceCents })),
      ...view.items.filter((i: { shippingCents: number }) => i.shippingCents > 0).map((i: { title: string; shippingCents: number }) => ({ title: `Livraison — ${i.title}`, priceCents: i.shippingCents })),
    ],
    returnUrl,
  });
  check(await db.from('payments').insert({
    order_id: order.id, provider: pay.name, provider_session_id: session.sessionId, amount_cents: order.total_cents, currency: order.currency, return_url: returnUrl,
  }));
  return json({ order: view, checkoutUrl: session.url }, 201);
}));
