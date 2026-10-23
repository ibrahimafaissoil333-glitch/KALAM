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
        line_items: r.items.map((i) => ({ quantity: 1, price_data: { currency: r.currency.toLowerCase(), unit_amount: i.priceCents, product_data: { name: i.title } } })),
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
          taxCents: s.total_details?.amount_tax ?? undefined, taxCountry: s.customer_details?.address?.country ?? undefined,
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
