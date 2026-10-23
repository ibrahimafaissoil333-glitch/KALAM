import { env } from './http.ts';
import { InvalidSignature, Outcome, WebhookEvent } from './payments.ts';

/**
 * Paiement et versement Mobile Money (Comores : Huri Money, Mvola Comores ;
 * Madagascar : MVola, Orange Money, Airtel Money). Un prestataire par environnement,
 * choisi par MOBILE_MONEY_PROVIDER ; les clés viennent uniquement des variables d'environnement.
 */
export interface MobileMoneyRequest {
  orderId: string;
  reference: string;
  amountCents: number;
  currency: string;
  country: string;
  operator: string;
  msisdn: string; // format international sans « + » (ex. 2693212345)
}
export type MobileMoneyStatus = 'pending' | 'succeeded' | 'failed';
export interface PayoutRequest {
  payoutId: string;
  amountCents: number;
  currency: string;
  country: string;
  operator: string;
  msisdn: string;
}

export interface MobileMoneyProvider {
  name: string;
  /** Demande de paiement : l'acheteur reçoit une notification et confirme sur son téléphone. */
  initiate(req: MobileMoneyRequest): Promise<{ sessionId: string }>;
  /** Statut côté opérateur (filet de sécurité si le callback n'arrive pas). */
  getStatus(sessionId: string): Promise<MobileMoneyStatus>;
  /** Callback de l'opérateur : signature vérifiée, sinon InvalidSignature. */
  parseCallback(raw: string, headers: Headers): Promise<WebhookEvent>;
  /** Versement au vendeur sur son numéro Mobile Money. */
  payout(req: PayoutRequest): Promise<{ ok: boolean; ref?: string; reason?: string }>;
}

/** Règles de numéro par pays (numéro national, sans indicatif). */
export const MSISDN_RULES: Record<string, { dial: string; length: number; prefixes: RegExp }> = {
  KM: { dial: '269', length: 7, prefixes: /^[34]/ },
  MG: { dial: '261', length: 9, prefixes: /^3[2-489]/ },
};

/** Normalise un numéro saisi (« +269 321 23 45 », « 034 12 345 67 »…) ; null si invalide. */
export function normalizeMsisdn(country: string, input: unknown): string | null {
  const rule = MSISDN_RULES[country];
  if (!rule || typeof input !== 'string') return null;
  let d = input.replace(/[\s.\-()]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith(rule.dial) && d.length === rule.dial.length + rule.length) d = d.slice(rule.dial.length);
  if (d.length === rule.length + 1 && d.startsWith('0')) d = d.slice(1);
  if (!/^\d+$/.test(d) || d.length !== rule.length || !rule.prefixes.test(d)) return null;
  return rule.dial + d;
}

export const maskMsisdn = (msisdn: string) => `****${msisdn.slice(-4)}`;

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
 * Simulation (développement, tests, et production tant que les contrats opérateurs ne sont pas signés) :
 * aucun argent ne circule. Un numéro se terminant par 0000 est refusé. La confirmation « sur le téléphone »
 * est simulée par la fonction fake-mobile-money, qui envoie un callback signé comme le ferait l'opérateur.
 */
export class FakeMobileMoney implements MobileMoneyProvider {
  name = 'fake_mm';
  static TOLERANCE = 300;
  constructor(private secret: string) {
    if (!secret) throw new Error('FAKE_MM_SECRET manquant');
  }
  async initiate(req: MobileMoneyRequest) {
    return { sessionId: `fake_mm_${req.operator.toLowerCase()}_${crypto.randomUUID()}` };
  }
  async getStatus() {
    return 'pending' as const;
  }
  async sign(body: string, t = Math.floor(Date.now() / 1000)) {
    return `t=${t},v1=${await hmacHex(this.secret, `${t}.${body}`)}`;
  }
  async parseCallback(raw: string, headers: Headers): Promise<WebhookEvent> {
    const header = headers.get('x-mm-signature');
    if (!header) throw new InvalidSignature('Signature absente');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > FakeMobileMoney.TOLERANCE) throw new InvalidSignature('Horodatage hors tolérance');
    if (!parts.v1 || !safeEqual(await hmacHex(this.secret, `${t}.${raw}`), parts.v1)) throw new InvalidSignature('Signature invalide');
    const b = JSON.parse(raw);
    const outcome: Outcome = b.status === 'SUCCESS' ? 'succeeded' : b.status === 'FAILED' ? 'failed' : 'ignored';
    return { eventId: b.transactionId, type: `mobile_money.${String(b.status).toLowerCase()}`, outcome, sessionId: b.requestId, paymentId: b.transactionId, reason: b.reason };
  }
  /** Simule l'issue côté opérateur : refus pour les numéros finissant par 0000. */
  outcomeFor(msisdnLast4: string | null) {
    return msisdnLast4 === '0000' ? { status: 'FAILED', reason: 'Solde insuffisant ou demande refusée (simulation)' } : { status: 'SUCCESS' };
  }
  async payout(req: PayoutRequest) {
    if (req.msisdn.endsWith('0000')) return { ok: false, reason: 'Numéro refusé par l’opérateur (simulation)' };
    return { ok: true, ref: `fake_payout_${crypto.randomUUID()}` };
  }
}

export function mobileMoneyProvider(): MobileMoneyProvider {
  const name = env('MOBILE_MONEY_PROVIDER', 'fake');
  if (name === 'fake') return new FakeMobileMoney(env('FAKE_MM_SECRET'));
  // Les intégrations réelles (API MVola, Orange Money, Airtel Money, Huri Money) s'ajoutent ici,
  // chacune implémentant MobileMoneyProvider avec ses propres clés (variables d'environnement).
  throw new Error(`Prestataire Mobile Money non disponible : ${name}`);
}

/**
 * Simulation : joue la réponse de l'acheteur sur son téléphone en envoyant un callback signé
 * à payment-webhook par HTTP, exactement comme le ferait l'opérateur.
 */
export async function simulateCallback(mm: FakeMobileMoney, sessionId: string, msisdnLast4: string | null, forced?: 'SUCCESS' | 'FAILED') {
  const o = forced ? { status: forced, reason: forced === 'FAILED' ? 'Refusé sur le téléphone (simulation)' : undefined } : mm.outcomeFor(msisdnLast4);
  const body = JSON.stringify({ transactionId: `mm_tx_${sessionId}`, requestId: sessionId, ...o });
  await fetch(`${env('SUPABASE_URL')}/functions/v1/payment-webhook?provider=mobile_money`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mm-signature': await mm.sign(body) },
    body,
  });
}
