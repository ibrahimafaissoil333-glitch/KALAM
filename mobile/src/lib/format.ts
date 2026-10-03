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
