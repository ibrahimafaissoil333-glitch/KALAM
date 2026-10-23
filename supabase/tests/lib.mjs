// Outils partagés par le script de démonstration et les tests (Node + supabase-js).
import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';

export const URL_ = process.env.SUPABASE_URL;
export const ANON = process.env.SUPABASE_ANON_KEY;
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export const service = () => createClient(URL_, SERVICE, opts);
export const anon = () => createClient(URL_, ANON, opts);

export const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const slug = (s) => norm(s).replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function buildEpub({ title, author, chapters }) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:folio:${esc(title)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>fr</dc:language></metadata><manifest>${chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`);
  chapters.forEach((c, i) => zip.file(`OEBPS/c${i}.xhtml`, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="fr"><head><title>${esc(c.title)}</title></head><body><h1>${esc(c.title)}</h1>${c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</body></html>`));
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

/** Contenu de lecture (le même format que produit la fonction admin à l'envoi d'un EPUB). */
export function contentFor(title, chapters) {
  const ch = chapters.map((c) => ({ title: c.title, blocks: [{ t: 'h', text: c.title }, ...c.paragraphs.map((p) => ({ t: 'p', text: p }))] }));
  const wordCount = ch.reduce((n, c) => n + c.blocks.reduce((m, b) => m + b.text.split(/\s+/).length, 0), 0);
  return { title, author: '', chapters: ch, wordCount };
}

/** Crée un e-book publié avec ses fichiers dans le stockage privé. */
export async function createEbook(db, { title, author = 'Yanis Okafor', category = 'Roman', priceCents = 1299, status = 'PUBLISHED', downloadAllowed = true, featured = false, colors, chapters, publishedAt } = {}) {
  const { data: cat, error: ce } = await db.from('categories').upsert({ name: category, slug: slug(category) }, { onConflict: 'name' }).select().single();
  if (ce) throw ce;
  chapters ??= [{ title: 'Un', paragraphs: Array.from({ length: 20 }, (_, i) => `Paragraphe ${i + 1}`) }];
  const { data: e, error } = await db.from('ebooks').insert({
    slug: `${slug(title)}-${randomUUID().slice(0, 6)}`, title, author, description: 'Description', category_id: cat.id,
    price_cents: priceCents, status, published_at: publishedAt ?? new Date().toISOString(), download_allowed: downloadAllowed, featured,
    ...(colors ?? {}),
  }).select().single();
  if (error) throw error;
  const epub = await buildEpub({ title, author, chapters });
  const content = Buffer.from(JSON.stringify(contentFor(title, chapters)));
  const mainPath = `${e.id}/main-${Date.now()}.epub`;
  const contentPath = `${e.id}/content-${Date.now()}.json`;
  for (const [p, b, t] of [[mainPath, epub, 'application/epub+zip'], [contentPath, content, 'application/json']]) {
    const { error: ue } = await db.storage.from('ebooks').upload(p, b, { contentType: t });
    if (ue) throw ue;
  }
  await db.from('ebook_files').insert([
    { ebook_id: e.id, kind: 'MAIN', storage_path: mainPath, mime_type: 'application/epub+zip', size_bytes: epub.length },
    { ebook_id: e.id, kind: 'CONTENT', storage_path: contentPath, mime_type: 'application/json', size_bytes: content.length },
  ]);
  return e;
}
