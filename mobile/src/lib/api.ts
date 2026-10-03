import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://localhost:3000';

const REFRESH_KEY = 'folio.refresh';
const DEVICE_KEY = 'folio.device';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Le serveur n'a pas pu être joint (hors ligne, délai dépassé). */
export class NetworkError extends Error {
  constructor() {
    super('Connexion impossible. Vérifiez votre réseau.');
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export const session = {
  setAccess(t: string | null) {
    accessToken = t;
  },
  hasAccess: () => !!accessToken,
  async setRefresh(t: string | null) {
    if (t) await SecureStore.setItemAsync(REFRESH_KEY, t);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
  getRefresh: () => SecureStore.getItemAsync(REFRESH_KEY),
  onLost(cb: () => void) {
    onSessionLost = cb;
  },
};

/** Identifiant stable de l'appareil, utilisé pour la limite d'appareils et la révocation. */
export async function deviceInfo() {
  let key = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!key) {
    key = randomUUID();
    await SecureStore.setItemAsync(DEVICE_KEY, key);
  }
  const label = Constants.deviceName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android');
  return { deviceKey: key, deviceLabel: label.slice(0, 100), platform: Platform.OS === 'ios' ? 'ios' : 'android' };
}

export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; email: string; role: string };
}

/** Rafraîchissement unique partagé entre les requêtes simultanées. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const rt = await session.getRefresh();
      if (!rt) return false;
      const res = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
      if (!res.ok) {
        if (res.status === 401) {
          await session.setRefresh(null);
          accessToken = null;
          onSessionLost?.();
        }
        return false;
      }
      const s = (await res.json()) as SessionResponse;
      accessToken = s.accessToken;
      await session.setRefresh(s.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (accessToken && init.auth !== false) headers.authorization = `Bearer ${accessToken}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    return fetch(`${API_URL}/v1/${path.replace(/^\//, '')}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  };
  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && init.auth !== false && (await session.getRefresh()) && (await refreshSession())) res = await send();
  } catch {
    throw new NetworkError();
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = Array.isArray(body.message) ? body.message[0] : body.message;
    throw new ApiError(res.status, m ?? 'Une erreur est survenue. Réessayez.');
  }
  return body as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Une erreur est survenue.');

// ── Types partagés avec l'API ─────────────────────────────────

export interface Ebook {
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  category: { name: string; slug: string } | null;
  priceCents: number | null;
  currency: string;
  format: string | null;
  pages: number | null;
  downloadAllowed: boolean;
  cover: { bg: string; fg: string; tint: string; url: string | null };
  owned: boolean;
}

export interface LibraryItem extends Ebook {
  grantedAt: string;
  readable: boolean;
  contentVersion: string | null;
  progress: { chapterIndex: number; blockIndex: number; percent: number; updatedAt: string } | null;
}

export interface Block {
  t: 'h' | 'p' | 'q';
  text: string;
}
export interface BookContent {
  ebookId: string;
  contentVersion?: string;
  title: string;
  chapters: { title: string; blocks: Block[] }[];
  wordCount: number;
  preview?: boolean;
}

export type OrderStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED';
export interface Order {
  id: string;
  reference: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  items: { ebookId: string; title: string; priceCents: number }[];
}

export interface PublicConfig {
  appName: string;
  checkoutMode: { ios: 'external' | 'web_only'; android: 'external' | 'web_only' };
  webCheckoutUrl: string | null;
  supportEmail: string | null;
  legal: { terms: string | null; salesTerms: string | null; privacy: string | null; legalNotice: string | null };
}
