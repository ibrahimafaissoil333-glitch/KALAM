'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Appel à l'API via le proxy de l'admin (`/api/v1/...`). Redirige vers /login si la session est terminée. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api/v1/${path.replace(/^\//, '')}`, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError(401, 'Session expirée.');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    throw new ApiError(res.status, msg ?? 'Une erreur est survenue.');
  }
  return body as T;
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
