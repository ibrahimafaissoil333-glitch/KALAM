import type { Category, Ebook, File } from '../generated/prisma/client.js';
import { StorageService } from '../storage/storage.service.js';

export type EbookWithRels = Ebook & { category: Category | null; files?: File[] };

/** Représentation publique d'un e-book (aucune clé de stockage n'est exposée). */
export async function toPublicEbook(e: EbookWithRels, storage: StorageService, owned = false) {
  const cover = e.files?.find((f) => f.kind === 'COVER');
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    author: e.author,
    description: e.description,
    category: e.category ? { name: e.category.name, slug: e.category.slug } : null,
    priceCents: e.priceCents,
    currency: e.currency,
    format: e.format,
    pages: e.pages,
    downloadAllowed: e.downloadAllowed,
    publishedAt: e.publishedAt,
    cover: {
      bg: e.coverBg,
      fg: e.coverFg,
      tint: e.coverTint,
      // Les couvertures sont aussi en stockage privé : URL signée longue (24 h), mise en cache par l'app.
      url: cover ? (await storage.signedUrl(cover.storageKey, undefined, 86_400)).url : null,
    },
    owned,
  };
}

export type PublicEbook = Awaited<ReturnType<typeof toPublicEbook>>;
