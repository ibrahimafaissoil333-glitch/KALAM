import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Minuscules sans accents : sert à la recherche insensible aux accents. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function slugify(text: string): string {
  return normalize(text).replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Référence de commande lisible : FO-AB12CD34. */
export function orderReference(): string {
  return 'FO-' + randomBytes(4).toString('hex').toUpperCase();
}

export const PASSWORD_RULE = /^(?=.*[A-Za-zÀ-ÿ])(?=.*\d).{8,128}$/;
export const PASSWORD_RULE_MESSAGE =
  'Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.';
