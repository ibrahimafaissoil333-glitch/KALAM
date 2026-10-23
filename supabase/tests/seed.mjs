// Données de démonstration : les 6 e-books du prototype, un admin et un client.
// Prix = valeur de TEST (DEMO_PRICE_CENTS), pas une décision commerciale. Identifiants : .env (SEED_*).
import { createEbook, service } from './lib.mjs';

const BOOKS = [
  ["L'Art de ralentir", 'Inès Morel', 'Développement perso', '#1F3A5F', '#F4EBDD', '#E4E9F0', true],
  ['Cuisiner la saison', 'Paul Arnaud', 'Cuisine', '#D94A33', '#FFF4EC', '#F7E3DE', false],
  ["Freelance, mode d'emploi", 'Sarah Benali', 'Business', '#2F5D50', '#EAF2DA', '#E3ECE7', true],
  ['Les Nuits de Tanger', 'Yanis Okafor', 'Roman', '#14151F', '#D7F25C', '#E8EAD9', true],
  ['Investir sans stress', 'Claire Dumont', 'Finances', '#F2C14E', '#14151F', '#F8EFD6', false],
  ['Photographier la ville', 'Léo Martin', 'Créatif', '#5B3E96', '#F1E9FF', '#ECE6F4', true],
];
const CATEGORIES = ['Roman', 'Business', 'Développement perso', 'Cuisine', 'Finances', 'Créatif'];

const db = service();
const price = Number(process.env.DEMO_PRICE_CENTS ?? 100);

for (const [i, name] of CATEGORIES.entries()) {
  await db.from('categories').upsert({ name, slug: name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-'), sort: i }, { onConflict: 'name' });
}

const { data: existing } = await db.from('ebooks').select('title');
const have = new Set((existing ?? []).map((e) => e.title));
for (const [i, [title, author, category, bg, fg, tint, featured]] of BOOKS.entries()) {
  if (have.has(title)) continue;
  const chapters = [1, 2, 3, 4].map((ch) => ({
    title: ch === 1 ? 'Avant-propos' : `Chapitre ${ch - 1}`,
    paragraphs: Array.from({ length: 8 }, (_, n) =>
      `[Texte de démonstration — ${title}, chapitre ${ch}, paragraphe ${n + 1}.] Ce contenu remplace le texte réel de l'e-book fourni par le propriétaire. ` +
      `Il sert à vérifier la mise en page du lecteur : une colonne étroite, un interlignage généreux, la taille du texte réglable et la reprise de lecture à la bonne position.`),
  }));
  const e = await createEbook(db, {
    title, author, category, priceCents: price, featured, downloadAllowed: i % 2 === 0, chapters,
    colors: { cover_bg: bg, cover_fg: fg, cover_tint: tint },
    publishedAt: new Date(Date.now() - (BOOKS.length - i) * 86_400_000).toISOString(),
  });
  await db.from('ebooks').update({ description: `[Description de démonstration] ${title}, par ${author}. Le propriétaire remplacera ce texte par le sujet, la promesse et le public visé.`, format: 'EPUB', pages: 7 }).eq('id', e.id);
}

for (const [email, password, name, role] of [
  [process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, 'Administrateur', 'ADMIN'],
  [process.env.SEED_CUSTOMER_EMAIL, process.env.SEED_CUSTOMER_PASSWORD, 'Client démo', 'CUSTOMER'],
]) {
  if (!email || !password) continue;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, seed: true } });
  if (error && !/already/i.test(error.message)) throw error;
  if (data?.user && role === 'ADMIN') await db.from('profiles').update({ role }).eq('id', data.user.id);
}
console.log(`Démo prête : ${BOOKS.length} e-books, ${CATEGORIES.length} catégories, comptes SEED_* du .env.`);
