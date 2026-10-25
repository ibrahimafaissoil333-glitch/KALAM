import Stripe from 'npm:stripe@18';
import { env } from './http.ts';

/** Interface commune aux prestataires de paiement (docs/03b-supabase.md). */
export interface CheckoutRequest {
  orderId: string;
  reference: string;
  customerEmail: string;
  currency: string;
  items: { title: string; priceCents: number }[];
  returnUrl: string;
}
export type Outcome = 'succeeded' | 'failed' | 'refunded' | 'ignored';
export interface WebhookEvent {
  eventId: string;
  type: string;
  outcome: Outcome;
  sessionId?: string;
  paymentId?: string;
  reason?: string;
  taxCents?: number;
  taxCountry?: string;
}
export class InvalidSignature extends Error {}

// Devises sans centimes chez Stripe (dont KMF et MGA) : nos montants sont toujours stockés ×100.
const ZERO_DECIMAL = ['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
export const toStripeAmount = (cents: number, currency: string) => (ZERO_DECIMAL.includes(currency.toUpperCase()) ? Math.round(cents / 100) : cents);
export const fromStripeAmount = (amount: number, currency: string) => (ZERO_DECIMAL.includes(currency.toUpperCase()) ? amount * 100 : amount);

export interface PaymentProvider {
  name: string;
  createSession(req: CheckoutRequest): Promise<{ sessionId: string; url: string }>;
  parseWebhook(raw: string, headers: Headers): Promise<WebhookEvent>;
  refund(paymentId: string): Promise<void>;
}

const enc = new TextEncoder();
async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Prestataire factice (développement et tests) : page de paiement hébergée par la fonction
 * « fake-checkout », puis webhook signé HMAC-SHA256 avec horodatage. Désactivé en production.
 */
export class FakeProvider implements PaymentProvider {
  name = 'fake';
  static TOLERANCE = 300;
  constructor(private secret: string, private publicUrl: string) {
    if (!secret) throw new Error('FAKE_WEBHOOK_SECRET manquant');
  }
  async createSession() {
    const sessionId = `fake_cs_${crypto.randomUUID()}`;
    return { sessionId, url: `${this.publicUrl}/functions/v1/fake-checkout/${sessionId}` };
  }
  async sign(body: string, t = Math.floor(Date.now() / 1000)) {
    return `t=${t},v1=${await hmacHex(this.secret, `${t}.${body}`)}`;
  }
  async parseWebhook(raw: string, headers: Headers): Promise<WebhookEvent> {
    const header = headers.get('x-fake-signature');
    if (!header) throw new InvalidSignature('Signature absente');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > FakeProvider.TOLERANCE) throw new InvalidSignature('Horodatage hors tolérance');
    if (!parts.v1 || !safeEqual(await hmacHex(this.secret, `${t}.${raw}`), parts.v1)) throw new InvalidSignature('Signature invalide');
    const b = JSON.parse(raw);
    const outcome: Outcome = b.type === 'payment.succeeded' ? 'succeeded' : b.type === 'payment.failed' ? 'failed' : b.type === 'payment.refunded' ? 'refunded' : 'ignored';
    return { eventId: b.id, type: b.type, outcome, sessionId: b.sessionId, paymentId: b.paymentId, reason: b.reason };
  }
  async refund() {}
}

/** Stripe Checkout : aucune donnée de carte ne transite par Folio. */
export class StripeProvider implements PaymentProvider {
  name = 'stripe';
  private stripe: Stripe;
  constructor(key: string, private webhookSecret: string) {
    if (!key || !webhookSecret) throw new Error('STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET requis');
    this.stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  }
  async createSession(r: CheckoutRequest) {
    const sep = r.returnUrl.includes('?') ? '&' : '?';
    const s = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: r.customerEmail || undefined,
        client_reference_id: r.orderId,
        metadata: { orderId: r.orderId, reference: r.reference },
        payment_intent_data: { metadata: { orderId: r.orderId } },
        line_items: r.items.map((i) => ({ quantity: 1, price_data: { currency: r.currency.toLowerCase(), unit_amount: toStripeAmount(i.priceCents, r.currency), product_data: { name: i.title } } })),
        automatic_tax: { enabled: env('STRIPE_AUTOMATIC_TAX') === 'true' },
        success_url: `${r.returnUrl}${sep}order=${r.orderId}&result=success`,
        cancel_url: `${r.returnUrl}${sep}order=${r.orderId}&result=cancel`,
      },
      { idempotencyKey: `checkout-${r.orderId}` },
    );
    return { sessionId: s.id, url: s.url! };
  }
  async parseWebhook(raw: string, headers: Headers): Promise<WebhookEvent> {
    let ev: Stripe.Event;
    try {
      ev = await this.stripe.webhooks.constructEventAsync(raw, headers.get('stripe-signature') ?? '', this.webhookSecret, undefined, Stripe.createSubtleCryptoProvider());
    } catch {
      throw new InvalidSignature('Signature Stripe invalide');
    }
    const base = { eventId: ev.id, type: ev.type };
    switch (ev.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = ev.data.object;
        if (s.payment_status !== 'paid') return { ...base, outcome: 'ignored' };
        return {
          ...base, outcome: 'succeeded', sessionId: s.id,
          paymentId: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id,
          taxCents: s.total_details?.amount_tax == null ? undefined : fromStripeAmount(s.total_details.amount_tax, s.currency ?? 'EUR'), taxCountry: s.customer_details?.address?.country ?? undefined,
        };
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return { ...base, outcome: 'failed', sessionId: ev.data.object.id, reason: ev.type };
      case 'charge.refunded': {
        const c = ev.data.object;
        if (!c.refunded) return { ...base, outcome: 'ignored' };
        return { ...base, outcome: 'refunded', paymentId: typeof c.payment_intent === 'string' ? c.payment_intent : c.payment_intent?.id };
      }
      default:
        return { ...base, outcome: 'ignored' };
    }
  }
  async refund(paymentId: string) {
    await this.stripe.refunds.create({ payment_intent: paymentId }, { idempotencyKey: `refund-${paymentId}` });
  }
}

export function provider(): PaymentProvider {
  if (env('PAYMENT_PROVIDER', 'fake') === 'stripe') return new StripeProvider(env('STRIPE_SECRET_KEY'), env('STRIPE_WEBHOOK_SECRET'));
  return new FakeProvider(env('FAKE_WEBHOOK_SECRET'), env('PUBLIC_SUPABASE_URL', env('SUPABASE_URL')));
}

/** Adresse de retour fournie par l'app, acceptée seulement si son préfixe est autorisé (pas de redirection ouverte). */
export function safeReturnUrl(candidate?: string | null) {
  const prefixes = env('CHECKOUT_RETURN_PREFIXES', 'folio://').split(',').map((p) => p.trim()).filter(Boolean);
  if (candidate && candidate.length <= 300 && prefixes.some((p) => candidate.startsWith(p))) return candidate;
  return env('CHECKOUT_RETURN_URL', 'folio://checkout/return');
}

/**
 * PayPal (API Orders v2) : l'acheteur valide sur la page PayPal, puis le paiement est capturé côté
 * serveur (au retour via la fonction paypal-return, ou à la réception du webhook CHECKOUT.ORDER.APPROVED).
 * Les webhooks sont authentifiés par l'API PayPal verify-webhook-signature. Commandes en euros uniquement.
 */
export class PayPalProvider implements PaymentProvider {
  name = 'paypal';
  private base: string;
  constructor(private clientId: string, private secret: string, private webhookId: string, mode: string) {
    if (!clientId || !secret) throw new Error('PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET requis');
    this.base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  }

  private async token() {
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${this.clientId}:${this.secret}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayPal OAuth ${res.status}`);
    return (await res.json()).access_token as string;
  }

  private async call(path: string, body?: unknown, idem?: string) {
    const res = await fetch(`${this.base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json', ...(idem ? { 'PayPal-Request-Id': idem } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok && !(res.status === 422 && json?.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED')) throw new Error(`PayPal ${path} ${res.status} ${json?.name ?? ''}`);
    return json;
  }

  async createSession(r: CheckoutRequest) {
    const value = (c: number) => (c / 100).toFixed(2);
    const total = r.items.reduce((n, i) => n + i.priceCents, 0);
    const back = `${env('PUBLIC_SUPABASE_URL', env('SUPABASE_URL'))}/functions/v1/paypal-return?order=${r.orderId}`;
    const o = await this.call('/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: r.orderId, custom_id: r.orderId, invoice_id: r.reference, description: `Commande ${r.reference}`,
        amount: { currency_code: r.currency, value: value(total), breakdown: { item_total: { currency_code: r.currency, value: value(total) } } },
        items: r.items.map((i) => ({ name: i.title.slice(0, 127), quantity: '1', unit_amount: { currency_code: r.currency, value: value(i.priceCents) } })),
      }],
      payment_source: { paypal: { experience_context: { brand_name: 'Kalam', locale: 'fr-FR', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: `${back}&result=success`, cancel_url: `${back}&result=cancel` } } },
    }, `order-${r.orderId}`);
    const url = (o.links ?? []).find((l: { rel: string }) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
    if (!url) throw new Error('PayPal : lien de validation absent');
    return { sessionId: o.id as string, url: url as string };
  }

  /** Capture d'une commande validée par l'acheteur ; renvoie l'issue et l'identifiant de capture. */
  async capture(paypalOrderId: string): Promise<{ outcome: Outcome; paymentId?: string }> {
    const o = await this.call(`/v2/checkout/orders/${paypalOrderId}/capture`, {}, `capture-${paypalOrderId}`);
    const done = o.status === 'COMPLETED' ? o : await this.call(`/v2/checkout/orders/${paypalOrderId}`);
    const cap = done.purchase_units?.[0]?.payments?.captures?.[0];
    if (cap?.status === 'COMPLETED') return { outcome: 'succeeded', paymentId: cap.id };
    if (cap?.status === 'DECLINED' || cap?.status === 'FAILED') return { outcome: 'failed', paymentId: cap.id };
    return { outcome: 'ignored' };
  }

  async orderStatus(paypalOrderId: string) {
    return (await this.call(`/v2/checkout/orders/${paypalOrderId}`)).status as string;
  }

  async parseWebhook(raw: string, headers: Headers): Promise<WebhookEvent> {
    if (!this.webhookId) throw new InvalidSignature('PAYPAL_WEBHOOK_ID manquant');
    const event = JSON.parse(raw);
    const check = await this.call('/v1/notifications/verify-webhook-signature', {
      auth_algo: headers.get('paypal-auth-algo'), cert_url: headers.get('paypal-cert-url'), transmission_id: headers.get('paypal-transmission-id'),
      transmission_sig: headers.get('paypal-transmission-sig'), transmission_time: headers.get('paypal-transmission-time'),
      webhook_id: this.webhookId, webhook_event: event,
    }).catch(() => ({ verification_status: 'FAILURE' }));
    if (check.verification_status !== 'SUCCESS') throw new InvalidSignature('Signature PayPal invalide');
    const base = { eventId: event.id as string, type: event.event_type as string };
    const res = event.resource ?? {};
    switch (event.event_type) {
      case 'CHECKOUT.ORDER.APPROVED': {
        const c = await this.capture(res.id);
        return { ...base, outcome: c.outcome, sessionId: res.id, paymentId: c.paymentId, reason: c.outcome === 'failed' ? 'Paiement PayPal refusé' : undefined };
      }
      case 'PAYMENT.CAPTURE.COMPLETED':
        return { ...base, outcome: 'succeeded', sessionId: res.supplementary_data?.related_ids?.order_id, paymentId: res.id };
      case 'PAYMENT.CAPTURE.DENIED':
        return { ...base, outcome: 'failed', sessionId: res.supplementary_data?.related_ids?.order_id, reason: 'Paiement PayPal refusé' };
      case 'PAYMENT.CAPTURE.REFUNDED': {
        const capture = (res.links ?? []).find((l: { rel: string }) => l.rel === 'up')?.href?.split('/').pop();
        return { ...base, outcome: 'refunded', paymentId: capture };
      }
      default:
        return { ...base, outcome: 'ignored' };
    }
  }

  async refund(captureId: string) {
    await this.call(`/v2/payments/captures/${captureId}/refund`, {}, `refund-${captureId}`);
  }
}

/** PayPal : réel si les clés sont configurées, simulation (page de test) si PAYPAL_MODE=fake, sinon indisponible. */
export function paypalProvider(): PaymentProvider | null {
  if (env('PAYPAL_MODE') === 'fake') return new FakeProvider(env('FAKE_WEBHOOK_SECRET'), env('PUBLIC_SUPABASE_URL', env('SUPABASE_URL')));
  if (!env('PAYPAL_CLIENT_ID') || !env('PAYPAL_CLIENT_SECRET')) return null;
  return new PayPalProvider(env('PAYPAL_CLIENT_ID'), env('PAYPAL_CLIENT_SECRET'), env('PAYPAL_WEBHOOK_ID'), env('PAYPAL_MODE', 'sandbox'));
}
