// Lecture du contenu acheté, uniquement dans l'application : aucun fichier n'est téléchargeable.
// Vérifie le droit du compte (sinon 403, CA-19/CA-22) et journalise chaque accès.
import { check, env, handler, HttpError, json, serviceClient, userFromRequest } from '../_shared/http.ts';

// Lien très court, réservé au lecteur PDF intégré (jamais montré à l'utilisateur).
const VIEWER_URL_TTL = 60;

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const { user } = await userFromRequest(req);
  const { action, ebookId } = await req.json().catch(() => ({}));
  if (typeof ebookId !== 'string' || !/^[0-9a-f-]{36}$/i.test(ebookId)) throw new HttpError(400, 'Livre invalide.');
  if (action === 'download') throw new HttpError(403, 'Les livres numériques se lisent uniquement dans l’application. Le fichier n’est pas téléchargeable.');
  const db = serviceClient();
  const { data: ent } = await db.from('entitlements').select('id').eq('user_id', user.id).eq('ebook_id', ebookId).is('revoked_at', null).maybeSingle();
  if (!ent) throw new HttpError(403, "Vous n'avez pas accès à ce livre.");
  const ebook = check(await db.from('ebooks').select('id, ebook_files(*)').eq('id', ebookId).single());
  const file = (kind: string) => ebook.ebook_files.filter((f: { kind: string }) => f.kind === kind).sort((a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at))[0];

  if (action === 'content') {
    const f = file('CONTENT');
    if (!f) throw new HttpError(404, "Le contenu de ce livre n'est pas encore disponible.");
    const { data, error } = await db.storage.from('ebooks').download(f.storage_path);
    if (error || !data) throw new HttpError(404, 'Contenu introuvable.');
    await db.from('download_events').insert({ user_id: user.id, ebook_id: ebookId, kind: 'read' });
    return json({ ebookId, contentVersion: f.id, ...JSON.parse(await data.text()) });
  }

  // Livre PDF : affiché page par page dans le lecteur intégré de l'app.
  if (action === 'pdf') {
    const f = file('MAIN');
    if (!f || f.mime_type !== 'application/pdf') throw new HttpError(404, 'Ce livre ne se lit pas en PDF.');
    await db.from('download_events').insert({ user_id: user.id, ebook_id: ebookId, kind: 'read' });
    const signed = check(await db.storage.from('ebooks').createSignedUrl(f.storage_path, VIEWER_URL_TTL));
    // En local, l'URL interne (kong) est remplacée par l'adresse publique de Supabase.
    const url = signed.signedUrl.replace(env('SUPABASE_URL'), env('PUBLIC_SUPABASE_URL', env('SUPABASE_URL')));
    return json({ url, expiresAt: new Date(Date.now() + VIEWER_URL_TTL * 1000) });
  }

  throw new HttpError(400, 'Action inconnue.');
}));
