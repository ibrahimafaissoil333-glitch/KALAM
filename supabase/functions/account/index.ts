// Suppression du compte par son titulaire (RGPD), après vérification du mot de passe.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { check, env, handler, HttpError, json, serviceClient, userFromRequest } from '../_shared/http.ts';

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const { user } = await userFromRequest(req);
  const { action, password } = await req.json().catch(() => ({}));
  if (action !== 'delete') throw new HttpError(400, 'Action inconnue.');
  if (typeof password !== 'string' || !password || !user.email) throw new HttpError(400, 'Mot de passe incorrect.');

  const probe = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await probe.auth.signInWithPassword({ email: user.email, password });
  if (error) throw new HttpError(400, 'Mot de passe incorrect.');
  await probe.auth.signOut().catch(() => undefined);

  const db = serviceClient();
  check(await db.rpc('anonymize_user', { p_id: user.id }));
  const res = await db.auth.admin.updateUserById(user.id, { email: `supprime-${user.id}@invalid.folio`, user_metadata: {}, ban_duration: '876000h' });
  if (res.error) throw new HttpError(500, 'Suppression incomplète, contactez le support.');
  await db.auth.admin.signOut(user.id).catch(() => undefined);
  await db.from('audit_logs').insert({ actor_id: user.id, action: 'user.delete', target_type: 'user', target_id: user.id });
  return new Response(null, { status: 204 });
}));
