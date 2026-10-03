import { createHmac, randomUUID } from 'node:crypto';
import { safeEqual } from '../common/util.js';
import { CheckoutRequest, CheckoutSession, InvalidSignatureError, PaymentProvider, WebhookEvent } from './provider.js';

export interface FakeWebhookBody {
  id: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  sessionId: string;
  paymentId?: string;
  reason?: string;
}

/**
 * Prestataire factice pour le développement et les tests. Il suit le même chemin que le vrai :
 * page de paiement hébergée, puis webhook signé (HMAC-SHA256 avec horodatage). Interdit en production.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  static readonly TOLERANCE_SECONDS = 300;

  constructor(
    private readonly secret: string,
    private readonly publicApiUrl: string,
  ) {
    if (!secret) throw new Error('FAKE_WEBHOOK_SECRET requis pour le prestataire factice');
  }

  async createSession(req: CheckoutRequest): Promise<CheckoutSession> {
    const sessionId = `fake_cs_${randomUUID()}`;
    return { sessionId, url: `${this.publicApiUrl}/v1/fake-checkout/${sessionId}` };
  }

  sign(body: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const sig = createHmac('sha256', this.secret).update(`${timestamp}.${body}`).digest('hex');
    return `t=${timestamp},v1=${sig}`;
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent> {
    const header = headers['x-fake-signature'];
    if (typeof header !== 'string') throw new InvalidSignatureError('Signature absente');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > FakePaymentProvider.TOLERANCE_SECONDS) {
      throw new InvalidSignatureError('Horodatage hors tolérance');
    }
    const expected = createHmac('sha256', this.secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    if (!parts.v1 || !safeEqual(expected, parts.v1)) throw new InvalidSignatureError('Signature invalide');
    const body = JSON.parse(rawBody.toString('utf8')) as FakeWebhookBody;
    const outcome = body.type === 'payment.succeeded' ? 'succeeded' : body.type === 'payment.failed' ? 'failed' : body.type === 'payment.refunded' ? 'refunded' : 'ignored';
    return { eventId: body.id, type: body.type, outcome, sessionId: body.sessionId, paymentId: body.paymentId, reason: body.reason };
  }

  async refund(): Promise<void> {
    // Rien à appeler : le remboursement est appliqué directement par le service.
  }
}
