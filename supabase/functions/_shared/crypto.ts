import { env } from './http.ts';

/**
 * Chiffrement des coordonnées de paiement (IBAN, RIB, numéro Mobile Money) : AES-256-GCM,
 * clé de 32 octets en base64 dans PAYOUT_ENCRYPTION_KEY. Format stocké : « v1:<iv>:<chiffré> ».
 */
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key() {
  const raw = env('PAYOUT_ENCRYPTION_KEY');
  const bytes = raw ? unb64(raw) : new Uint8Array();
  if (bytes.length !== 32) throw new Error('PAYOUT_ENCRYPTION_KEY doit contenir 32 octets encodés en base64');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function decryptSecret(stored: string) {
  const [v, iv, ct] = stored.split(':');
  if (v !== 'v1' || !iv || !ct) throw new Error('Format chiffré inconnu');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(), unb64(ct)));
}

/** IBAN : contrôle du format et de la clé (mod 97). */
export function validIban(input: string) {
  const s = input.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return null;
  const rearranged = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1 ? s : null;
}
