import JSZip from 'npm:jszip@3';
import { XMLParser } from 'npm:fast-xml-parser@5';

/** Lecture d'un EPUB 2/3 en blocs de texte affichables nativement par l'app (titres, paragraphes, citations). */
export interface Block {
  t: 'h' | 'p' | 'q';
  text: string;
}
export interface BookContent {
  title: string;
  author: string;
  chapters: { title: string; blocks: Block[] }[];
  wordCount: number;
}
export class EpubError extends Error {}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true });
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»' };

const decode = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const clean = (h: string) => decode(h.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();

export function htmlToBlocks(html: string): Block[] {
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const out: Block[] = [];
  const re = /<(h[1-6]|p|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const text = clean(m[2]);
    if (text) out.push({ t: m[1].toLowerCase().startsWith('h') ? 'h' : m[1].toLowerCase() === 'blockquote' ? 'q' : 'p', text });
  }
  return out;
}

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' && '#text' in v ? String((v as Record<string, unknown>)['#text']) : '');
const join = (base: string, href: string) => {
  const parts = (base ? base + '/' + href : href).split('/');
  const out: string[] = [];
  for (const p of parts) p === '..' ? out.pop() : p && p !== '.' && out.push(p);
  return out.join('/');
};

export async function parseEpub(bytes: Uint8Array): Promise<BookContent> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new EpubError("Le fichier n'est pas une archive EPUB valide.");
  }
  const read = (p: string) => zip.file(p)?.async('string');
  const container = await read('META-INF/container.xml');
  if (!container) throw new EpubError('EPUB invalide : META-INF/container.xml manquant.');
  const opfPath: string | undefined = arr<Record<string, string>>(xml.parse(container)?.container?.rootfiles?.rootfile)[0]?.['full-path'];
  const opfRaw = opfPath && (await read(opfPath));
  if (!opfPath || !opfRaw) throw new EpubError('EPUB invalide : fichier OPF introuvable.');
  const pkg = xml.parse(opfRaw).package;
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const manifest = new Map(arr<Record<string, string>>(pkg?.manifest?.item).map((i) => [i.id, i.href]));
  const spine = arr<Record<string, string>>(pkg?.spine?.itemref).map((r) => manifest.get(r.idref)).filter(Boolean) as string[];
  if (!spine.length) throw new EpubError('EPUB invalide : aucun chapitre dans le spine.');
  const chapters: BookContent['chapters'] = [];
  for (const href of spine) {
    const html = await read(join(base, decodeURIComponent(href)));
    if (!html) continue;
    const blocks = htmlToBlocks(html);
    if (blocks.length) chapters.push({ title: blocks.find((b) => b.t === 'h')?.text ?? `Partie ${chapters.length + 1}`, blocks });
  }
  if (!chapters.length) throw new EpubError('EPUB sans texte lisible.');
  const meta = pkg?.metadata ?? {};
  const wordCount = chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + b.text.split(/\s+/).length, 0), 0);
  return { title: txt(arr(meta.title)[0]), author: txt(arr(meta.creator)[0]), chapters, wordCount };
}

export function previewOf(c: BookContent, maxBlocks: number): BookContent {
  const chapters: BookContent['chapters'] = [];
  let left = maxBlocks;
  for (const ch of c.chapters) {
    if (left <= 0) break;
    chapters.push({ title: ch.title, blocks: ch.blocks.slice(0, left) });
    left -= ch.blocks.length;
  }
  return { ...c, chapters, wordCount: 0 };
}

/** EPUB 3 minimal, pour les données de démonstration et les tests. */
export async function buildEpub(o: { title: string; author: string; chapters: { title: string; paragraphs: string[] }[] }) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:folio:${esc(o.title)}</dc:identifier><dc:title>${esc(o.title)}</dc:title><dc:creator>${esc(o.author)}</dc:creator><dc:language>fr</dc:language></metadata><manifest>${o.chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${o.chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`);
  o.chapters.forEach((c, i) => zip.file(`OEBPS/c${i}.xhtml`, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="fr"><head><title>${esc(c.title)}</title></head><body><h1>${esc(c.title)}</h1>${c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</body></html>`));
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
}
