// Coordonnées de paiement du vendeur (IBAN/RIB ou Mobile Money). Chiffrées ici avant d'être enregistrées :
// la base ne contient jamais la valeur en clair, et l'app ne reçoit que les 4 derniers caractères.
import { check, handler, HttpError, json, serviceClient, userFromRequest } from '../_shared/http.ts';
import { encryptSecret, validIban } from '../_shared/crypto.ts';
import { normalizeMsisdn } from '../_shared/mobile-money.ts';

const OPERATORS: Record<string, string[]> = { KM: ['HURI_MONEY', 'MVOLA_KM'], MG: ['MVOLA', 'ORANGE_MONEY', 'AIRTEL_MONEY'] };
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const { client, user } = await userFromRequest(req);
  const b = await req.json().catch(() => ({}));
  const holder = text(b.holderName, 120);
  if (!holder) throw new HttpError(400, 'Le nom du titulaire est obligatoire.');
  const country = text(b.country, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'Pays invalide.');

  let row: Record<string, unknown>;
  if (b.kind === 'BANK') {
    const raw = text(b.iban, 40).replace(/\s/g, '').toUpperCase();
    const iban = validIban(raw);
    // Sans IBAN, un RIB national (banque 5, guichet 5, compte 11, clé 2) est accepté.
    const value = iban ?? (/^\d{10}[A-Z0-9]{11}\d{2}$/.test(raw) ? raw : null);
    if (!value) throw new HttpError(400, 'IBAN ou RIB invalide. Vérifiez le numéro.');
    row = { kind: 'BANK', bank_name: text(b.bankName, 80) || null, operator: null, secret_ciphertext: await encryptSecret(value), last4: value.slice(-4) };
  } else if (b.kind === 'MOBILE_MONEY') {
    const operator = text(b.operator, 20).toUpperCase();
    if (!OPERATORS[country]?.includes(operator)) throw new HttpError(400, 'Opérateur Mobile Money invalide pour ce pays.');
    const msisdn = normalizeMsisdn(country, b.phone);
    if (!msisdn) throw new HttpError(400, 'Numéro Mobile Money invalide pour ce pays.');
    row = { kind: 'MOBILE_MONEY', operator, bank_name: null, secret_ciphertext: await encryptSecret(msisdn), last4: msisdn.slice(-4) };
  } else {
    throw new HttpError(400, 'Choisissez un compte bancaire ou Mobile Money.');
  }

  const db = serviceClient();
  const { count } = await db.from('seller_payout_accounts').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  if ((count ?? 0) >= 5) throw new HttpError(409, 'Cinq moyens de réception au maximum.');
  const makeDefault = (count ?? 0) === 0 || b.isDefault === true;
  if (makeDefault) await db.from('seller_payout_accounts').update({ is_default: false }).eq('user_id', user.id).eq('is_default', true);
  check(await db.from('seller_payout_accounts').insert({ ...row, user_id: user.id, country, holder_name: holder, is_default: makeDefault }));
  await db.from('audit_logs').insert({ actor_id: user.id, action: 'payout_account.add', target_type: 'user', target_id: user.id, meta: { kind: row.kind } });
  return json(check(await client.rpc('my_payout_accounts')), 201);
}));
