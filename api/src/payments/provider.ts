/** Interface commune aux prestataires de paiement (docs/03-conception-technique.md §2). */

export interface CheckoutRequest {
  orderId: string;
  reference: string;
  customerEmail: string;
  currency: string;
  totalCents: number;
  items: { title: string; priceCents: number }[];
  returnUrl: string;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

export type WebhookOutcome = 'succeeded' | 'failed' | 'refunded' | 'ignored';

export interface WebhookEvent {
  eventId: string;
  type: string;
  outcome: WebhookOutcome;
  sessionId?: string;
  paymentId?: string;
  reason?: string;
  taxCents?: number;
  taxCountry?: string;
}

export class InvalidSignatureError extends Error {}

export interface PaymentProvider {
  readonly name: string;
  createSession(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Vérifie la signature puis traduit l'événement. Lève InvalidSignatureError si la signature est absente ou fausse. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent>;
  refund(paymentId: string): Promise<void>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
