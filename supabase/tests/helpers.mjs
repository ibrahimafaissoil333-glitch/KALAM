import { createClient } from '@supabase/supabase-js';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { ANON, createEbook, service, URL_ } from './lib.mjs';

export const PASSWORD = 'motdepasse1';
const FN = `${URL_}/functions/v1`;
const fnEnv = Object.fromEntries(
  readFileSync(new URL('../functions/.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

export class Env {
  static async start() {
    const e = new Env();
    e.sql = new pg.Client({ connectionString: process.env.DB_URL });
    await e.sql.connect();
    e.db = service();
    await e.reset();
    return e;
  }

  async stop() {
    await this.sql.end();
  }

  async reset() {
    await this.sql.query(`truncate public.cart_items, public.order_items, public.payments, public.payment_events, public.entitlements,
      public.download_events, public.reading_progress, public.orders, public.ebook_views, public.ebook_files, public.ebooks, public.categories,
      public.devices, public.notification_prefs, public.audit_logs, public.email_outbox, public.settings, public.shipments, public.seller_earnings,
      public.payouts, public.seller_payout_accounts, public.shipping_addresses, public.payment_settings_log, public.ebook_shipping_options cascade`);
    await this.sql.query(`delete from public.profiles; delete from auth.users;`);
  }

  ebook(title = 'Les Nuits de Tanger', o = {}) {
    return createEbook(this.db, { title, ...o });
  }

  /** Inscription d'un client ; renvoie un client supabase-js connecté. */
  async register(name = 'Sarah', email = `u-${randomUUID()}@test.fr`, extra = {}) {
    const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await c.auth.signUp({ email, password: PASSWORD, options: { data: { name, accept_terms: true, ...extra } } });
    if (error) throw error;
    return { c, id: data.user.id, email, token: data.session.access_token };
  }

  async admin() {
    const u = await this.register('Admin', `admin-${randomUUID()}@test.fr`);
    await this.sql.query(`update public.profiles set role = 'ADMIN' where id = $1`, [u.id]);
    return u;
  }

  /** Appel HTTP brut d'une fonction Edge (pour lire le statut). */
  async fn(name, { token = ANON, body, headers = {}, method = 'POST', form } = {}) {
    const res = await fetch(`${FN}/${name}`, {
      method,
      headers: { authorization: `Bearer ${token}`, apikey: ANON, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* corps vide */ }
    return { status: res.status, body: json, text };
  }

  async order(u, ebookIds, extra = {}) {
    const r = await this.fn('checkout', { token: u.token, body: { ebookIds, ...extra } });
    if (r.status !== 201 && r.status !== 200) throw new Error(`checkout ${r.status} ${r.text}`);
    const { rows } = await this.sql.query('select provider_session_id from public.payments where order_id = $1', [r.body.order.id]);
    return { orderId: r.body.order.id, sessionId: rows[0]?.provider_session_id, checkoutUrl: r.body.checkoutUrl };
  }

  sign(raw, t = Math.floor(Date.now() / 1000)) {
    return `t=${t},v1=${createHmac('sha256', fnEnv.FAKE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex')}`;
  }

  webhook(body, { signature } = {}) {
    const raw = JSON.stringify(body);
    return this.fn('payment-webhook', { body: undefined, form: raw, headers: { 'content-type': 'application/json', 'x-fake-signature': signature ?? this.sign(raw) } });
  }

  async pay(u, ebookIds) {
    const o = await this.order(u, ebookIds);
    const r = await this.webhook({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', sessionId: o.sessionId, paymentId: `pi_${randomUUID()}` });
    if (r.status !== 200) throw new Error(`webhook ${r.status} ${r.text}`);
    return o;
  }

  async outbox(kind) {
    const { rows } = await this.sql.query('select * from public.email_outbox where kind = $1', [kind]);
    return rows;
  }
}

/** Erreur attendue d'un appel RPC : renvoie le message. */
export async function rpcError(promise) {
  const { error } = await promise;
  if (!error) throw new Error('Une erreur était attendue');
  return error;
}

/** Signature d'un callback Mobile Money simulé (même secret que la fonction Edge). */
export function mmSign(raw, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', fnEnv.FAKE_MM_SECRET).update(`${t}.${raw}`).digest('hex')}`;
}
export const CRON_SECRET = () => fnEnv.CRON_SECRET;
