export function money(cents: number | null | undefined, currency = 'EUR') {
  if (cents === null || cents === undefined) return '[Prix à définir]';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

export function dateTime(d: string | Date) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(d));
}

export function shortDate(d: string | Date) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
}

export const plural = (n: number) => `${n} e-book${n > 1 ? 's' : ''}`;

/** Recherche insensible aux accents (bibliothèque, côté appareil). */
export const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export const PASSWORD_RULES = [
  { label: 'Au moins 8 caractères', test: (p: string) => p.length >= 8 },
  { label: 'Une lettre et un chiffre', test: (p: string) => /[A-Za-zÀ-ÿ]/.test(p) && /\d/.test(p) },
];
export const passwordOk = (p: string) => PASSWORD_RULES.every((r) => r.test(p));

// ── Marketplace ───────────────────────────────────────────────

export const KIND_LABEL = { PHYSICAL: 'Livre physique', DIGITAL: 'Livre numérique' } as const;
export const CONDITION_LABEL = { NEW: 'Neuf', VERY_GOOD: 'Très bon état', GOOD: 'Bon état', WORN: 'Usé' } as const;
export const SHIPPING_LABEL = { HAND: 'Remise en main propre', POST: 'Envoi postal', COURIER: 'Livraison par coursier' } as const;
export const OPERATOR_LABEL: Record<string, string> = {
  HURI_MONEY: 'Huri Money', MVOLA_KM: 'Mvola Comores', MVOLA: 'MVola', ORANGE_MONEY: 'Orange Money', AIRTEL_MONEY: 'Airtel Money',
};
export const COUNTRY_LABEL: Record<string, string> = { KM: 'Comores', MG: 'Madagascar', FR: 'France', YT: 'Mayotte', RE: 'La Réunion' };
export const CURRENCIES = ['EUR', 'KMF', 'MGA'] as const;
export const LANGUAGES = [['fr', 'Français'], ['en', 'Anglais'], ['ar', 'Arabe'], ['mg', 'Malgache'], ['sw', 'Comorien / swahili']] as const;

/** Montant saisi (« 12,50 », « 5000 ») → centimes ; null si invalide. */
export function parseMoney(input: string): number | null {
  const v = input.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}
export const centsToInput = (c: number | null | undefined) => (c === null || c === undefined ? '' : String(c / 100).replace('.', ','));
