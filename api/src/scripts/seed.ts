/**
 * Données de démonstration : les 6 e-books du prototype V1, un compte admin et un compte client.
 * Les prix sont des valeurs de TEST (DEMO_PRICE_CENTS), pas des décisions commerciales.
 * Les identifiants viennent de .env (SEED_ADMIN_* / SEED_CUSTOMER_*).
 */
import argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service.js';
import { normalize } from '../common/util.js';
import { loadConfig } from '../config.js';
import { buildEpub } from '../epub/build-epub.js';
import { parseEpub } from '../epub/epub.js';
import { StorageService } from '../storage/storage.service.js';

const BOOKS = [
  { slug: 'l-art-de-ralentir', title: "L'Art de ralentir", author: 'Inès Morel', category: 'Développement perso', bg: '#1F3A5F', fg: '#F4EBDD', tint: '#E4E9F0', featured: true },
  { slug: 'cuisiner-la-saison', title: 'Cuisiner la saison', author: 'Paul Arnaud', category: 'Cuisine', bg: '#D94A33', fg: '#FFF4EC', tint: '#F7E3DE', featured: false },
  { slug: 'freelance-mode-d-emploi', title: "Freelance, mode d'emploi", author: 'Sarah Benali', category: 'Business', bg: '#2F5D50', fg: '#EAF2DA', tint: '#E3ECE7', featured: true },
  { slug: 'les-nuits-de-tanger', title: 'Les Nuits de Tanger', author: 'Yanis Okafor', category: 'Roman', bg: '#14151F', fg: '#D7F25C', tint: '#E8EAD9', featured: true },
  { slug: 'investir-sans-stress', title: 'Investir sans stress', author: 'Claire Dumont', category: 'Finances', bg: '#F2C14E', fg: '#14151F', tint: '#F8EFD6', featured: false },
  { slug: 'photographier-la-ville', title: 'Photographier la ville', author: 'Léo Martin', category: 'Créatif', bg: '#5B3E96', fg: '#F1E9FF', tint: '#ECE6F4', featured: true },
];
const CATEGORIES = ['Roman', 'Business', 'Développement perso', 'Cuisine', 'Finances', 'Créatif'];

function demoChapters(title: string) {
  const p = (n: number, ch: number) =>
    `[Texte de démonstration — ${title}, chapitre ${ch}, paragraphe ${n}.] Ce contenu remplace le texte réel de l'e-book fourni par le propriétaire. ` +
    `Il sert à vérifier la mise en page du lecteur : une colonne étroite, un interlignage généreux, la taille du texte réglable et la reprise de lecture à la bonne position.`;
  return [1, 2, 3, 4].map((ch) => ({
    title: ch === 1 ? 'Avant-propos' : `Chapitre ${ch - 1}`,
    paragraphs: Array.from({ length: 8 }, (_, i) => p(i + 1, ch)),
  }));
}

async function main() {
  const cfg = loadConfig();
  const prisma = new PrismaService();
  const storage = new StorageService(cfg);
  const price = Number(process.env.DEMO_PRICE_CENTS ?? 100);

  for (const [i, name] of CATEGORIES.entries()) {
    const slug = normalize(name).replace(/[^a-z0-9]+/g, '-');
    await prisma.category.upsert({ where: { name }, create: { name, slug, order: i }, update: { order: i } });
  }

  for (const [i, b] of BOOKS.entries()) {
    const category = await prisma.category.findUniqueOrThrow({ where: { name: b.category } });
    const description = `[Description de démonstration] ${b.title}, par ${b.author}. Le propriétaire remplacera ce texte par le sujet, la promesse et le public visé.`;
    const ebook = await prisma.ebook.upsert({
      where: { slug: b.slug },
      create: {
        slug: b.slug, title: b.title, author: b.author, description, categoryId: category.id,
        priceCents: price, currency: 'EUR', status: 'PUBLISHED', featured: b.featured,
        coverBg: b.bg, coverFg: b.fg, coverTint: b.tint, downloadAllowed: i % 2 === 0,
        publishedAt: new Date(Date.now() - (BOOKS.length - i) * 86_400_000),
        searchText: normalize(`${b.title} ${b.author} ${b.category} ${description}`),
      },
      update: {},
      include: { files: true },
    });
    if (!ebook.files.some((f) => f.kind === 'MAIN')) {
      const epub = await buildEpub({ title: b.title, author: b.author, chapters: demoChapters(b.title) });
      const content = parseEpub(epub);
      const mainKey = StorageService.keyFor(ebook.id, 'MAIN', 'epub');
      const contentKey = StorageService.keyFor(ebook.id, 'CONTENT', 'json');
      await storage.put(mainKey, epub, 'application/epub+zip');
      await storage.put(contentKey, Buffer.from(JSON.stringify(content)), 'application/json');
      await prisma.file.createMany({
        data: [
          { ebookId: ebook.id, kind: 'MAIN', storageKey: mainKey, mimeType: 'application/epub+zip', sizeBytes: epub.length, originalName: `${b.slug}.epub` },
          { ebookId: ebook.id, kind: 'CONTENT', storageKey: contentKey, mimeType: 'application/json', sizeBytes: 0 },
        ],
      });
      await prisma.ebook.update({ where: { id: ebook.id }, data: { format: 'EPUB', pages: Math.max(1, Math.round(content.wordCount / 250)) } });
    }
  }

  const accounts = [
    { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD, name: 'Administrateur', role: 'ADMIN' as const },
    { email: process.env.SEED_CUSTOMER_EMAIL, password: process.env.SEED_CUSTOMER_PASSWORD, name: 'Client démo', role: 'CUSTOMER' as const },
  ];
  for (const a of accounts) {
    if (!a.email || !a.password) continue;
    await prisma.user.upsert({
      where: { email: a.email },
      create: {
        email: a.email, name: a.name, role: a.role, termsAcceptedAt: new Date(),
        passwordHash: await argon2.hash(a.password, { type: argon2.argon2id }),
        notificationPref: { create: {} },
      },
      update: {},
    });
  }

  console.log(`Démo prête : ${BOOKS.length} e-books, ${CATEGORIES.length} catégories, comptes de .env (SEED_*).`);
  await prisma.$disconnect();
}

await main();
