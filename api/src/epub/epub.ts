import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { posix } from 'node:path';

/** Bloc de texte affichable nativement par le lecteur mobile. */
export interface Block {
  t: 'h' | 'p' | 'q';
  text: string;
}
export interface Chapter {
  title: string;
  blocks: Block[];
}
export interface BookContent {
  title: string;
  author: string;
  chapters: Chapter[];
  wordCount: number;
}

export class EpubError extends Error {}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true });

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»' };

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function clean(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** Extrait titres, paragraphes et citations d'un document XHTML, dans l'ordre. */
export function htmlToBlocks(html: string): Block[] {
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const blocks: Block[] = [];
  const re = /<(h[1-6]|p|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase();
    const text = clean(m[2]);
    if (!text) continue;
    blocks.push({ t: tag.startsWith('h') ? 'h' : tag === 'blockquote' ? 'q' : 'p', text });
  }
  return blocks;
}

function arr<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && '#text' in v) return String((v as { '#text': unknown })['#text']);
  return '';
}

/** Lit un EPUB 2/3 : container.xml → OPF → spine → chapitres. */
export function parseEpub(buf: Buffer): BookContent {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch {
    throw new EpubError("Le fichier n'est pas une archive EPUB valide.");
  }
  const read = (p: string) => zip.getEntry(p)?.getData().toString('utf8');
  const container = read('META-INF/container.xml');
  if (!container) throw new EpubError('EPUB invalide : META-INF/container.xml manquant.');
  const opfPath = arr(xml.parse(container)?.container?.rootfiles?.rootfile)[0]?.['full-path'];
  const opfRaw = opfPath && read(opfPath);
  if (!opfRaw) throw new EpubError('EPUB invalide : fichier OPF introuvable.');
  const pkg = xml.parse(opfRaw).package;
  const base = posix.dirname(opfPath);
  const manifest = new Map<string, string>();
  for (const it of arr<Record<string, string>>(pkg?.manifest?.item)) manifest.set(it.id, it.href);
  const spine = arr<Record<string, string>>(pkg?.spine?.itemref).map((r) => manifest.get(r.idref)).filter(Boolean) as string[];
  if (!spine.length) throw new EpubError('EPUB invalide : aucun chapitre dans le spine.');

  const chapters: Chapter[] = [];
  for (const href of spine) {
    const html = read(posix.normalize(posix.join(base, decodeURIComponent(href))));
    if (!html) continue;
    const blocks = htmlToBlocks(html);
    if (!blocks.length) continue;
    const heading = blocks.find((b) => b.t === 'h')?.text;
    chapters.push({ title: heading ?? `Partie ${chapters.length + 1}`, blocks });
  }
  if (!chapters.length) throw new EpubError('EPUB sans texte lisible.');
  const meta = pkg?.metadata ?? {};
  const wordCount = chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + b.text.split(/\s+/).length, 0), 0);
  return { title: text(arr(meta.title)[0]), author: text(arr(meta.creator)[0]), chapters, wordCount };
}

/** Premiers blocs du livre, servis comme extrait gratuit. */
export function previewOf(content: BookContent, maxBlocks: number): BookContent {
  const chapters: Chapter[] = [];
  let left = maxBlocks;
  for (const c of content.chapters) {
    if (left <= 0) break;
    chapters.push({ title: c.title, blocks: c.blocks.slice(0, left) });
    left -= c.blocks.length;
  }
  return { ...content, chapters, wordCount: 0 };
}
