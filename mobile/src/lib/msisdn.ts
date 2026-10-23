/** Règles des numéros Mobile Money (mêmes règles que le serveur, supabase/functions/_shared/mobile-money.ts). */
const RULES: Record<string, { dial: string; length: number; prefixes: RegExp; example: string }> = {
  KM: { dial: '269', length: 7, prefixes: /^[34]/, example: '321 23 45' },
  MG: { dial: '261', length: 9, prefixes: /^3[2-489]/, example: '034 12 345 67' },
};

export const phoneExample = (country: string) => RULES[country]?.example ?? '';

/** Numéro national valide pour le pays (indicatif et 0 initial acceptés). */
export function validMsisdn(country: string, input: string) {
  const rule = RULES[country];
  if (!rule) return false;
  let d = input.replace(/[\s.\-()]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith(rule.dial) && d.length === rule.dial.length + rule.length) d = d.slice(rule.dial.length);
  if (d.length === rule.length + 1 && d.startsWith('0')) d = d.slice(1);
  return /^\d+$/.test(d) && d.length === rule.length && rule.prefixes.test(d);
}
