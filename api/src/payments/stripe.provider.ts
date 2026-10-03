import Stripe from 'stripe';
import { CheckoutRequest, CheckoutSession, InvalidSignatureError, PaymentProvider, WebhookEvent } from './provider.js';

/**
 * Stripe Checkout (page hébergée). Aucune donnée de carte ne transite par l'API.
 * Événements écoutés : checkout.session.completed, checkout.session.async_payment_succeeded,
 * checkout.session.async_payment_failed, checkout.session.expired, charge.refunded.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    if (!secretKey || !webhookSecret) throw new Error('STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET sont requis');
    this.stripe = new Stripe(secretKey);
  }

  async createSession(req: CheckoutRequest): Promise<CheckoutSession> {
    const sep = req.returnUrl.includes('?') ? '&' : '?';
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: req.customerEmail,
        client_reference_id: req.orderId,
        metadata: { orderId: req.orderId, reference: req.reference },
        payment_intent_data: { metadata: { orderId: req.orderId } },
        line_items: req.items.map((i) => ({
          quantity: 1,
          price_data: { currency: req.currency.toLowerCase(), unit_amount: i.priceCents, product_data: { name: i.title } },
        })),
        // TVA UE selon le pays de l'acheteur, si Stripe Tax est activé sur le compte (décision D4).
        automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === 'true' },
        success_url: `${req.returnUrl}${sep}order=${req.orderId}&result=success`,
        cancel_url: `${req.returnUrl}${sep}order=${req.orderId}&result=cancel`,
      },
      { idempotencyKey: `checkout-${req.orderId}` },
    );
    return { sessionId: session.id, url: session.url! };
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent> {
    const sig = headers['stripe-signature'];
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig as string, this.webhookSecret);
    } catch {
      throw new InvalidSignatureError('Signature Stripe invalide');
    }
    const base = { eventId: event.id, type: event.type };
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = event.data.object;
        // Un paiement différé (virement, etc.) termine la session sans être encore payé.
        if (s.payment_status !== 'paid') return { ...base, outcome: 'ignored', sessionId: s.id };
        return {
          ...base,
          outcome: 'succeeded',
          sessionId: s.id,
          paymentId: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id,
          taxCents: s.total_details?.amount_tax ?? undefined,
          taxCountry: s.customer_details?.address?.country ?? undefined,
        };
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return { ...base, outcome: 'failed', sessionId: event.data.object.id, reason: event.type };
      case 'charge.refunded': {
        const c = event.data.object;
        if (!c.refunded) return { ...base, outcome: 'ignored' }; // remboursement partiel : traitement manuel
        return { ...base, outcome: 'refunded', paymentId: typeof c.payment_intent === 'string' ? c.payment_intent : c.payment_intent?.id };
      }
      default:
        return { ...base, outcome: 'ignored' };
    }
  }

  async refund(paymentId: string): Promise<void> {
    await this.stripe.refunds.create({ payment_intent: paymentId }, { idempotencyKey: `refund-${paymentId}` });
  }
}
