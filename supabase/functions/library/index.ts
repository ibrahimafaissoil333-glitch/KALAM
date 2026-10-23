// Accès au contenu acheté. Vérifie le droit du compte (sinon 403, CA-19/CA-22), journalise chaque accès.
import { check, env, handler, HttpError, json, serviceClient, userFromRequest } from '../_shared/http.ts';

const SIGNED_URL_TTL = 300;

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const { user } = await userFromRequest(req);
  const { action, ebookId } = await req.json().catch(() => ({}));
  if (typeof ebookId !== 'string' || !/^[0-9a-f-]{36}$/i.test(ebookId)) throw new HttpError(400, 'E-book invalide.');
  const db = serviceClient();
  const { data: ent } = await db.from('entitlements').select('id').eq('user_id', user.id).eq('ebook_id', ebookId).is('revoked_at', null).maybeSingle();
  if (!ent) throw new HttpError(403, "Vous n'avez pas accès à cet e-book.");
  const ebook = check(await db.from('ebooks').select('id, slug, download_allowed, ebook_files(*)').eq('id', ebookId).single());
  const file = (kind: string) => ebook.ebook_files.filter((f: { kind: string }) => f.kind === kind).sort((a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at))[0];

  if (action === 'content') {
    const f = file('CONTENT');
    if (!f) throw new HttpError(404, "Le contenu de cet e-book n'est pas encore disponible.");
    const { data, error } = await db.storage.from('ebooks').download(f.storage_path);
    if (error || !data) throw new HttpError(404, 'Contenu introuvable.');
    await db.from('download_events').insert({ user_id: user.id, ebook_id: ebookId, kind: 'read' });
    return json({ ebookId, contentVersion: f.id, ...JSON.parse(await data.text()) });
  }

  if (action === 'download') {
    if (!ebook.download_allowed) throw new HttpError(403, "Le téléchargement du fichier n'est pas proposé pour cet e-book.");
    const f = file('MAIN');
    if (!f) throw new HttpError(404, 'Fichier indisponible.');
    const settings = check(await db.rpc('app_settings')) as { maxDownloadsPerBook: number | null };
    if (settings.maxDownloadsPerBook !== null) {
      const { count } = await db.from('download_events').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('ebook_id', ebookId).eq('kind', 'download');
      if ((count ?? 0) >= settings.maxDownloadsPerBook) {
        throw new HttpError(429, `Limite de ${settings.maxDownloadsPerBook} téléchargements atteinte pour cet e-book. Contactez le support.`);
      }
    }
    await db.from('download_events').insert({ user_id: user.id, ebook_id: ebookId, kind: 'download' });
    const ext = f.mime_type === 'application/pdf' ? 'pdf' : 'epub';
    const signed = check(await db.storage.from('ebooks').createSignedUrl(f.storage_path, SIGNED_URL_TTL, { download: `${ebook.slug}.${ext}` }));
    // En local, l'URL interne (kong) est remplacée par l'adresse publique de Supabase.
    const url = signed.signedUrl.replace(env('SUPABASE_URL'), env('PUBLIC_SUPABASE_URL', env('SUPABASE_URL')));
    return json({ url, expiresAt: new Date(Date.now() + SIGNED_URL_TTL * 1000) });
  }

  throw new HttpError(400, 'Action inconnue.');
}));
