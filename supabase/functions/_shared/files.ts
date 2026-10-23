import { check, HttpError, serviceClient } from './http.ts';
import { EpubError, parseEpub } from './epub.ts';

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_COVER = 5 * 1024 * 1024;
const MAX_BOOK = 100 * 1024 * 1024;

/** Envoi d'une couverture (cover) ou du fichier du livre (main : EPUB ou PDF), en remplaçant l'ancien. */
export async function uploadBookFile(ebookId: string, kindInput: string, file: FormDataEntryValue | null) {
  const db = serviceClient();
  const kind = kindInput.toUpperCase();
  if (!(file instanceof File)) throw new HttpError(400, 'Aucun fichier reçu.');
  if (kind !== 'COVER' && kind !== 'MAIN') throw new HttpError(400, 'Type de fichier attendu : cover ou main.');
  const ebook = check(await db.from('ebooks').select('id, format, pages, kind').eq('id', ebookId).single());
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stamp = Date.now();

  const replace = async (k: 'COVER' | 'MAIN' | 'CONTENT', bucket: string, body: Uint8Array, mime: string, ext: string, original = '') => {
    const { data: old } = await db.from('ebook_files').select('id, storage_path').eq('ebook_id', ebookId).eq('kind', k);
    const path = `${ebookId}/${k.toLowerCase()}-${stamp}.${ext}`;
    check(await db.storage.from(bucket).upload(path, body, { contentType: mime, upsert: false }));
    check(await db.from('ebook_files').insert({ ebook_id: ebookId, kind: k, storage_path: path, mime_type: mime, size_bytes: body.length, original_name: original }));
    for (const o of old ?? []) {
      await db.from('ebook_files').delete().eq('id', o.id);
      await db.storage.from(bucket).remove([o.storage_path]);
    }
  };

  if (kind === 'COVER') {
    if (!COVER_TYPES.includes(file.type)) throw new HttpError(400, 'Couverture : JPEG, PNG ou WebP attendu.');
    if (bytes.length > MAX_COVER) throw new HttpError(400, 'Couverture trop lourde (5 Mo maximum).');
    await replace('COVER', 'covers', bytes, file.type, file.type.split('/')[1], file.name);
    return { kind, name: file.name, size: bytes.length };
  }
  if (ebook.kind === 'PHYSICAL') throw new HttpError(400, 'Un livre physique n’a pas de fichier à télécharger.');
  if (bytes.length > MAX_BOOK) throw new HttpError(400, 'Fichier trop lourd (100 Mo maximum).');
  const name = file.name.toLowerCase();
  const isEpub = name.endsWith('.epub') || file.type === 'application/epub+zip';
  const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
  if (!isEpub && !isPdf) throw new HttpError(400, 'Fichier du livre : EPUB ou PDF attendu.');
  if (isEpub) {
    let content;
    try {
      content = await parseEpub(bytes);
    } catch (err) {
      throw new HttpError(400, err instanceof EpubError ? err.message : 'EPUB illisible.');
    }
    await replace('MAIN', 'ebooks', bytes, 'application/epub+zip', 'epub', file.name);
    await replace('CONTENT', 'ebooks', new TextEncoder().encode(JSON.stringify(content)), 'application/json', 'json');
    await db.from('ebooks').update({ format: ebook.format ?? 'EPUB', pages: ebook.pages ?? Math.max(1, Math.round(content.wordCount / 250)) }).eq('id', ebookId);
  } else {
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new HttpError(400, 'Ce fichier n’est pas un PDF valide.');
    await replace('MAIN', 'ebooks', bytes, 'application/pdf', 'pdf', file.name);
    // Un PDF n'a pas de version « lecture intégrée » : il se lit après téléchargement.
    await db.from('ebooks').update({ format: ebook.format ?? 'PDF', download_allowed: true }).eq('id', ebookId);
  }
  return { kind, name: file.name, size: bytes.length };
}

/** Supprime du stockage les fichiers renvoyés par admin_delete_ebook / seller_delete_ebook. */
export async function removeStoredFiles(files: { path: string; kind: string }[]) {
  const db = serviceClient();
  for (const f of files) await db.storage.from(f.kind === 'COVER' ? 'covers' : 'ebooks').remove([f.path]);
}
