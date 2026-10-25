'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { coverUrl, SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const PG_STATUS: Record<string, number> = { PT404: 404, PT409: 409, PT400: 400, '42501': 403, '28000': 401 };

function toLogin() {
  window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
}

/** Les couvertures sont dans le bucket public « covers » : on reconstruit leur URL. */
function withCovers<T>(v: T): T {
  if (Array.isArray(v)) return v.map(withCovers) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withCovers(x)]));
    const c = o.cover as Record<string, unknown> | undefined;
    if (c && typeof c === 'object' && 'path' in c) o.cover = { ...c, url: coverUrl(c.path as string) };
    return o as T;
  }
  return v;
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const status = PG_STATUS[error.code ?? ''] ?? 400;
    if (status === 401 || /JWT/i.test(error.message)) toLogin();
    throw new ApiError(status, error.message);
  }
  return withCovers(data as T);
}

/** Fonction Edge « admin » : remboursement, envoi de fichiers, suppression, anonymisation. */
async function adminFn<T>(body: Record<string, unknown> | FormData): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    toLogin();
    throw new ApiError(401, 'Session expirée.');
  }
  const isForm = body instanceof FormData;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${data.session.access_token}`, ...(isForm ? {} : { 'content-type': 'application/json' }) },
    body: isForm ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.message ?? 'Une erreur est survenue.');
  return withCovers(json as T);
}

/**
 * Point d'entrée des écrans : chaque route de l'ancienne API REST correspond
 * à une fonction SQL d'administration ou à la fonction Edge « admin ».
 */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const [p, query = ''] = path.replace(/^\//, '').split('?');
  const qs = new URLSearchParams(query);
  const b = (init.json ?? {}) as Record<string, unknown>;
  const opt = (k: string) => qs.get(k) || null;
  let m: RegExpMatchArray | null;

  if (p === 'catalog/categories') {
    const { data, error } = await supabase.from('categories').select('name, slug').order('sort');
    if (error) throw new ApiError(400, error.message);
    return data as T;
  }
  if (p === 'admin/stats') return rpc('admin_stats', { p_period: opt('period') ?? '30d' });
  if (p === 'admin/settings') return method === 'PUT' ? rpc('admin_put_settings', { p: b }) : rpc('admin_get_settings');
  // Mobile Money : interrupteurs (réglage en base, sans redéploiement) et historique
  if (p === 'admin/mobile-money') return method === 'PUT' ? rpc('admin_set_mobile_money', { p: b }) : rpc('admin_get_mobile_money');
  if (p === 'admin/mobile-money/log') return rpc('admin_mobile_money_log');
  // Paiements de la plateforme : configuration (sans clés) et revenus de l'administrateur
  if (p === 'admin/payments-config') return adminFn({ action: 'payments-config' });
  if (p === 'admin/payment-keys') return method === 'DELETE' ? adminFn({ action: 'clear-payment-keys', provider: b.provider }) : adminFn({ action: 'save-payment-keys', ...b });
  if (p === 'admin/revenue') return rpc('admin_platform_revenue');
  // Vendeurs : ventes et modération des annonces
  if (p === 'admin/sellers') return rpc('admin_sellers', { p_q: opt('q') });
  if ((m = p.match(/^admin\/sellers\/([^/]+)$/))) return rpc('admin_seller', { p_id: m[1] });
  if ((m = p.match(/^admin\/listings\/([^/]+)\/(remove|restore)$/))) return rpc('admin_moderate_listing', { p_id: m[1], p_action: m[2], p_reason: b.reason ?? null });
  // Carrousel publicitaire de l'accueil
  if (p === 'admin/promos' && method === 'GET') return rpc('admin_promo_slides');
  if (p === 'admin/promos' && method === 'POST') return rpc('admin_save_promo_slide', { p_id: null, p: b });
  if ((m = p.match(/^admin\/promos\/([^/]+)\/move$/))) return rpc('admin_move_promo_slide', { p_id: m[1], p_dir: b.dir });
  if ((m = p.match(/^admin\/promos\/([^/]+)\/video$/))) {
    if (method === 'DELETE') return adminFn({ action: 'remove-promo-video', slideId: m[1] });
    const form = init.body as FormData;
    form.set('kind', 'promo-video');
    form.set('slideId', m[1]);
    return adminFn(form);
  }
  if ((m = p.match(/^admin\/promos\/([^/]+)$/))) {
    if (method === 'DELETE') return adminFn({ action: 'delete-promo-slide', slideId: m[1] });
    return rpc('admin_save_promo_slide', { p_id: m[1], p: b });
  }
  // Versements aux vendeurs
  if (p === 'admin/payouts/due') return rpc('admin_payouts_due');
  if (p === 'admin/payouts') return rpc('admin_payouts');
  if (p === 'admin/payouts/bank') return rpc('admin_mark_bank_payout', { p_seller: b.sellerId, p_currency: b.currency, p_reference: b.reference ?? null });
  if ((m = p.match(/^admin\/payout-accounts\/([^/]+)\/reveal$/))) return adminFn({ action: 'reveal-payout-account', accountId: m[1] });
  if (p === 'admin/audit-logs') return rpc('admin_audit_logs', { p_page: Number(opt('page') ?? 1) });

  if (p === 'admin/ebooks' && method === 'GET') return rpc('admin_ebooks', { p_q: opt('q'), p_status: opt('status') });
  if (p === 'admin/ebooks' && method === 'POST') return rpc('admin_save_ebook', { p_id: null, p: b });
  if ((m = p.match(/^admin\/ebooks\/([^/]+)\/files\/(cover|main)$/))) {
    const form = init.body as FormData;
    form.set('ebookId', m[1]);
    form.set('kind', m[2]);
    return adminFn(form);
  }
  if ((m = p.match(/^admin\/ebooks\/([^/]+)\/(publish|unpublish|archive)$/))) return rpc('admin_set_ebook_status', { p_id: m[1], p_action: m[2] });
  if ((m = p.match(/^admin\/ebooks\/([^/]+)$/))) {
    if (method === 'PATCH') return rpc('admin_save_ebook', { p_id: m[1], p: b });
    if (method === 'DELETE') return adminFn({ action: 'delete-ebook', id: m[1] });
    return rpc('admin_ebook', { p_id: m[1] });
  }

  if (p === 'admin/orders') return rpc('admin_orders', { p_q: opt('q'), p_status: opt('status'), p_page: Number(opt('page') ?? 1) });
  if ((m = p.match(/^admin\/orders\/([^/]+)\/refund$/))) return adminFn({ action: 'refund', orderId: m[1] });
  if ((m = p.match(/^admin\/orders\/([^/]+)$/))) return rpc('admin_order', { p_id: m[1] });

  if (p === 'admin/users') return rpc('admin_users', { p_q: opt('q'), p_status: opt('status'), p_role: opt('role') });
  if ((m = p.match(/^admin\/users\/([^/]+)\/status$/))) return rpc('admin_set_user_status', { p_id: m[1], p_status: b.status });
  if ((m = p.match(/^admin\/users\/([^/]+)\/export$/))) return rpc('admin_export_user', { p_id: m[1] });
  if ((m = p.match(/^admin\/users\/([^/]+)\/anonymize$/))) return adminFn({ action: 'anonymize', userId: m[1] });
  if ((m = p.match(/^admin\/users\/([^/]+)$/))) return rpc('admin_user', { p_id: m[1] });

  throw new ApiError(404, `Route inconnue : ${p}`);
}

/** Export CSV des commandes (sans donnée bancaire), formules neutralisées pour les tableurs. */
export async function downloadOrdersCsv(q: string | null, status: string | null) {
  const rows = await rpc<Record<string, string>[]>('admin_orders_export', { p_q: q, p_status: status });
  const cols = ['reference', 'date', 'statut', 'client', 'email', 'articles', 'total', 'devise', 'tva', 'pays'];
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + [cols.map(cell).join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: `commandes-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Chargement d'une ressource avec états chargement / erreur / rechargement. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path);
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export const money = (cents: number | null | undefined, currency = 'EUR') =>
  cents === null || cents === undefined ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);

export const date = (d: string | Date | null | undefined, withTime = false) =>
  d
    ? new Intl.DateTimeFormat('fr-FR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(d))
    : '—';
