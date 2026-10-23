import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors, ...headers } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const env = (name: string, fallback = '') => Deno.env.get(name) ?? fallback;

const SERVICE_KEY = () => env('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = () => env('SUPABASE_ANON_KEY');

/** Client « service » : contourne RLS. Réservé aux opérations décidées par le serveur. */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), SERVICE_KEY(), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Client agissant au nom de l'utilisateur de la requête (RLS appliquée), et son identifiant. */
export async function userFromRequest(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  const client = createClient(env('SUPABASE_URL'), ANON_KEY(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Authentification requise.');
  const { data: profile } = await serviceClient().from('profiles').select('id, email, name, role, status').eq('id', data.user.id).single();
  if (!profile || profile.status !== 'ACTIVE') throw new HttpError(401, 'Compte inactif.');
  return { client, user: profile as { id: string; email: string | null; name: string; role: 'CUSTOMER' | 'ADMIN'; status: string } };
}

/** Traduit les erreurs SQL de nos fonctions (codes P04xx) en statuts HTTP. */
export function pgStatus(code?: string) {
  if (code && /^PT\d{3}$/.test(code)) return Number(code.slice(2));
  switch (code) {
    case '42501': return 403;
    case '28000': return 401;
    default: return 400;
  }
}

export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ message: err.message }, err.status);
      const e = err as { message?: string; code?: string };
      if (e?.code) return json({ message: e.message }, pgStatus(e.code));
      console.error(err);
      return json({ message: 'Une erreur est survenue.' }, 500);
    }
  };
}

/** Lève l'erreur d'un appel Supabase en conservant son code SQL. */
export function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data;
}
