// Extrait gratuit, sans compte : seuls les N premiers blocs d'un livre publié sont renvoyés.
import { handler, HttpError, json, serviceClient } from '../_shared/http.ts';
import { BookContent, previewOf } from '../_shared/epub.ts';

Deno.serve(handler(async (req) => {
  const slug = new URL(req.url).searchParams.get('slug') ?? (req.method === 'POST' ? (await req.json().catch(() => ({}))).slug : null);
  if (!slug) throw new HttpError(400, 'Livre manquant.');
  const db = serviceClient();
  const { data: e } = await db.from('ebooks').select('id, title, preview_blocks, ebook_files(storage_path, kind, created_at)').eq('slug', slug).eq('status', 'PUBLISHED').maybeSingle();
  const f = e?.ebook_files.filter((x: { kind: string }) => x.kind === 'CONTENT').sort((a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at))[0];
  if (!e || !f || e.preview_blocks <= 0) throw new HttpError(404, 'Aucun extrait disponible.');
  const { data } = await db.storage.from('ebooks').download(f.storage_path);
  if (!data) throw new HttpError(404, 'Aucun extrait disponible.');
  const content = JSON.parse(await data.text()) as BookContent;
  return json({ ...previewOf(content, e.preview_blocks), ebookId: e.id, title: e.title, preview: true });
}));
