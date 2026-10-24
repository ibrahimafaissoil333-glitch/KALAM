import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { File, UploadType } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { coverUrl, SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase';

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

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Une erreur est survenue.');

/** Identifiant stable de l'appareil, utilisé pour la limite d'appareils. */
export async function deviceInfo() {
  let key = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!key) {
    key = randomUUID();
    await SecureStore.setItemAsync(DEVICE_KEY, key);
  }
  const label = Constants.deviceName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android');
  return { deviceKey: key, deviceLabel: label.slice(0, 100), platform: Platform.OS === 'ios' ? 'ios' : 'android' };
}

// ── Accès à Supabase ──────────────────────────────────────────

const PG_STATUS: Record<string, number> = { PT404: 404, PT409: 409, PT400: 400, '42501': 403, '28000': 401 };

function fail(error: { message: string; code?: string } | null): never {
  if (!error) throw new ApiError(500, 'Une erreur est survenue.');
  if (/fetch|network/i.test(error.message)) throw new NetworkError();
  throw new ApiError(PG_STATUS[error.code ?? ''] ?? 400, error.message);
}

/** Les couvertures sont dans le bucket public « covers » : on reconstruit leur URL. */
function withCovers<T>(v: T): T {
  if (Array.isArray(v)) return v.map(withCovers) as T;
  if (v && typeof v === 'object') {
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withCovers(x)]));
    if (o.cover && typeof o.cover === 'object' && 'path' in o.cover) o.cover = { ...o.cover, url: coverUrl(o.cover.path as string) };
    return o as T;
  }
  return v;
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch {
    throw new NetworkError();
  }
  if (res.error) fail(res.error);
  return withCovers(res.data as T);
}

/** Appel d'une fonction Edge (paiement, lecture, compte). */
export async function edge<T>(name: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${data.session?.access_token ?? SUPABASE_KEY}`,
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.message ?? 'Une erreur est survenue. Réessayez.');
  return withCovers(json as T);
}

/**
 * Point d'entrée unique des écrans : chaque route de l'ancienne API REST correspond
 * à une fonction SQL (RPC) ou à une fonction Edge Supabase.
 */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const [p, query = ''] = path.replace(/^\//, '').split('?');
  const qs = new URLSearchParams(query);
  const b = (init.body ?? {}) as Record<string, unknown>;
  const seg = p.split('/');
  const route = `${method} ${p}`;
  let m: RegExpMatchArray | null;

  if (route === 'GET config') return rpc('public_config');
  if (route === 'GET catalog/home') return rpc('catalog_home');
  if (route === 'GET catalog/categories') {
    const { data, error } = await supabase.from('categories').select('name, slug').order('sort');
    if (error) fail(error);
    return data as T;
  }
  if (route === 'GET catalog/ebooks') {
    return rpc('search_ebooks', { p_q: qs.get('q'), p_category: qs.get('category'), p_sort: qs.get('sort') ?? 'new', p_page: Number(qs.get('page') ?? 1), p_page_size: Number(qs.get('pageSize') ?? 20), p_kind: qs.get('kind') });
  }
  if ((m = p.match(/^catalog\/ebooks\/([^/]+)\/preview$/))) return edge('preview', { slug: decodeURIComponent(m[1]) });
  if ((m = p.match(/^catalog\/ebooks\/([^/]+)$/))) return rpc('ebook_detail', { p_slug: decodeURIComponent(m[1]) });

  if (route === 'GET me') return rpc('me');
  if (route === 'PATCH me') return rpc('update_my_profile', { p_name: b.name });
  if (route === 'GET me/export') return rpc('my_export');
  if (route === 'DELETE me') return edge('account', { action: 'delete', password: b.password });
  if (route === 'PUT me/password') return changePassword(String(b.currentPassword), String(b.newPassword)) as T;
  if (route === 'GET me/notifications') {
    const { data, error } = await supabase.from('notification_prefs').select('ebook_updates, marketing').maybeSingle();
    if (error) fail(error);
    return { orders: true, ebookUpdates: data?.ebook_updates ?? true, marketing: data?.marketing ?? false } as T;
  }
  if (route === 'PUT me/notifications') return rpc('set_notification_prefs', { p_ebook_updates: b.ebookUpdates, p_marketing: b.marketing });
  if (route === 'GET me/devices') {
    const { data, error } = await supabase.from('devices').select('id, label, platform, last_seen_at, created_at').order('last_seen_at', { ascending: false });
    if (error) fail(error);
    return data.map((d) => ({ id: d.id, label: d.label, platform: d.platform, lastSeenAt: d.last_seen_at, createdAt: d.created_at })) as T;
  }
  if ((m = p.match(/^me\/devices\/(.+)$/)) && method === 'DELETE') return rpc('remove_device', { p_id: m[1] });

  if (route === 'GET cart') return rpc('cart_get');
  if (route === 'POST cart/items') return rpc('cart_add', { p_ebook: b.ebookId });
  if ((m = p.match(/^cart\/items\/(.+)$/)) && method === 'DELETE') return rpc('cart_remove', { p_ebook: m[1] });
  if (route === 'POST cart/merge') return rpc('cart_merge', { p_ebooks: b.ebookIds ?? [] });

  if (route === 'POST orders') return edge('checkout', b, init.headers);
  if ((m = p.match(/^orders\/(.+)\/status$/))) return edge('payment-status', { orderId: m[1] });
  if (route === 'GET me/physical-orders') return rpc('my_physical_orders');
  if ((m = p.match(/^shipments\/(.+)\/delivered$/))) return rpc('confirm_delivery', { p_shipment: m[1] });

  // Adresses de livraison
  if (route === 'GET me/addresses') return rpc('my_addresses');
  if (route === 'POST me/addresses') return rpc('save_address', { p: b });
  if ((m = p.match(/^me\/addresses\/(.+)$/)) && method === 'DELETE') return rpc('delete_address', { p_id: m[1] });

  // Moyens de réception des gains (coordonnées chiffrées par la fonction Edge)
  if (route === 'GET me/payout-accounts') return rpc('my_payout_accounts');
  if (route === 'POST me/payout-accounts') return edge('payout-accounts', b);
  if ((m = p.match(/^me\/payout-accounts\/(.+)\/default$/))) return rpc('set_default_payout_account', { p_id: m[1] });
  if ((m = p.match(/^me\/payout-accounts\/(.+)$/)) && method === 'DELETE') return rpc('delete_payout_account', { p_id: m[1] });

  // Espace vendeur
  if (route === 'GET seller/dashboard') return rpc('seller_dashboard');
  if (route === 'GET seller/ebooks') return rpc('seller_ebooks');
  if (route === 'POST seller/ebooks') return rpc('seller_save_ebook', { p_id: null, p: b });
  if ((m = p.match(/^seller\/ebooks\/([^/]+)\/status$/))) return rpc('seller_set_status', { p_id: m[1], p_action: b.action });
  if ((m = p.match(/^seller\/ebooks\/([^/]+)\/shipping$/))) return rpc('seller_set_shipping', { p_id: m[1], p: b.options });
  if ((m = p.match(/^seller\/ebooks\/([^/]+)$/))) {
    if (method === 'GET') return rpc('seller_ebook', { p_id: m[1] });
    if (method === 'PATCH') return rpc('seller_save_ebook', { p_id: m[1], p: b });
    if (method === 'DELETE') return edge('seller', { action: 'delete', id: m[1] });
  }
  if (route === 'GET seller/shipments') return rpc('seller_shipments');
  if ((m = p.match(/^seller\/shipments\/(.+)\/shipped$/))) return rpc('seller_mark_shipped', { p_shipment: m[1], p_tracking: b.tracking ?? null });
  if (route === 'GET orders') return rpc('my_orders');
  if ((m = p.match(/^orders\/(.+)$/))) return rpc('my_order', { p_id: m[1] });

  if (route === 'GET library') return rpc('my_library');
  if ((m = p.match(/^library\/(.+)\/content$/))) return edge('library', { action: 'content', ebookId: m[1] });
  if ((m = p.match(/^library\/(.+)\/download-url$/))) return edge('library', { action: 'download', ebookId: m[1] });
  if ((m = p.match(/^library\/(.+)\/progress$/))) return rpc('save_progress', { p_ebook: m[1], p_chapter: b.chapterIndex, p_block: b.blockIndex, p_percent: b.percent });

  throw new ApiError(404, `Route inconnue : ${seg.join('/')}`);
}

/**
 * Envoi d'une couverture ou du fichier du livre (multipart vers la fonction Edge « seller »).
 * Envoi natif d'expo-file-system : le fetch d'Expo n'accepte pas les fichiers { uri } dans un FormData.
 */
export async function uploadSellerFile(ebookId: string, kind: 'cover' | 'main', file: { uri: string; name: string; mimeType: string }) {
  const { data } = await supabase.auth.getSession();
  let res: { status: number; body: string };
  try {
    res = await new File(file.uri).upload(`${SUPABASE_URL}/functions/v1/seller`, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: file.mimeType,
      parameters: { ebookId, kind },
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${data.session?.access_token ?? SUPABASE_KEY}` },
    });
  } catch {
    throw new NetworkError();
  }
  let json: { message?: string } = {};
  try {
    json = JSON.parse(res.body);
  } catch {
    // corps vide ou non JSON
  }
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, json.message ?? 'Envoi impossible. Réessayez.');
  return withCovers(json as SellerEbook);
}

/** Changement de mot de passe : le mot de passe actuel est vérifié avant la mise à jour. */
async function changePassword(current: string, next: string) {
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new ApiError(401, 'Session expirée.');
  const check = await supabase.auth.signInWithPassword({ email, password: current });
  if (check.error) throw new ApiError(400, 'Mot de passe actuel incorrect.');
  const res = await supabase.auth.updateUser({ password: next });
  if (res.error) throw new ApiError(400, res.error.message);
  // Toutes les autres sessions sont fermées.
  await supabase.auth.signOut({ scope: 'others' });
}

// ── Types partagés ────────────────────────────────────────────

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
  kind: ProductKind;
  language: string;
  condition: BookCondition | null;
  stock: number | null;
  inStock: boolean;
  seller: { id: string; name: string } | null;
  shipping: ShippingOption[];
}

export type ProductKind = 'PHYSICAL' | 'DIGITAL';
export type BookCondition = 'NEW' | 'VERY_GOOD' | 'GOOD' | 'WORN';
export type ShippingMode = 'HAND' | 'POST' | 'COURIER';
export interface ShippingOption {
  id: string;
  mode: ShippingMode;
  priceCents: number;
  countries: string[];
  delayDays: number | null;
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
  paymentMethod?: 'CARD' | 'MOBILE_MONEY' | 'PAYPAL';
  items: { ebookId: string; title: string; priceCents: number; kind?: ProductKind; shippingCents?: number; seller?: { id: string; name: string } | null }[];
  shipments?: Shipment[];
  shippingAddress?: Address | null;
}

export interface Shipment {
  id: string;
  status: 'TO_SHIP' | 'SHIPPED' | 'DELIVERED' | 'CANCELED';
  tracking: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  seller: { id: string; name: string } | null;
}

export interface Address {
  id: string;
  fullName: string;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string | null;
  country: string;
  phone: string | null;
}

export interface MobileMoneyCountry {
  code: string;
  name: string;
  currency: string;
  dialCode: string;
  operators: { code: string; label: string }[];
}

export interface PayoutAccount {
  id: string;
  kind: 'BANK' | 'MOBILE_MONEY';
  country: string;
  operator: string | null;
  holderName: string;
  bankName: string | null;
  masked: string;
  isDefault: boolean;
}

/** Annonce vue par son vendeur (statut, fichiers, conditions de mise en vente). */
export interface SellerEbook extends Ebook {
  status: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
  sales: number;
  files: { id: string; kind: 'COVER' | 'MAIN' | 'CONTENT'; mimeType: string; originalName: string | null }[];
  publishable: string[];
}

export interface PublicConfig {
  appName: string;
  checkoutMode: { ios: 'external' | 'web_only'; android: 'external' | 'web_only' };
  webCheckoutUrl: string | null;
  supportEmail: string | null;
  legal: { terms: string | null; salesTerms: string | null; privacy: string | null; legalNotice: string | null };
  mobileMoney?: { enabled: boolean; countries: MobileMoneyCountry[] };
  paypal?: { enabled: boolean; currencies: string[] };
}
