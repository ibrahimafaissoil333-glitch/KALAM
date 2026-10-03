import JSZip from 'jszip';

/** Fabrique un EPUB 3 minimal. Sert aux données de démonstration et aux tests. */
export async function buildEpub(opts: { title: string; author: string; chapters: { title: string; paragraphs: string[] }[] }): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  const items = opts.chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const refs = opts.chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('');
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:folio:${esc(opts.title)}</dc:identifier><dc:title>${esc(opts.title)}</dc:title><dc:creator>${esc(opts.author)}</dc:creator><dc:language>fr</dc:language></metadata><manifest>${items}</manifest><spine>${refs}</spine></package>`,
  );
  opts.chapters.forEach((c, i) => {
    zip.file(
      `OEBPS/c${i}.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="fr"><head><title>${esc(c.title)}</title></head><body><h1>${esc(c.title)}</h1>${c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</body></html>`,
    );
  });
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}
