# Plan — Marketplace multi-vendeurs, livres physiques et Mobile Money

> Statut : **proposition à valider**. Aucun code n'est écrit tant que le plan et les réponses aux questions du §7 ne sont pas validés.

## 1. Analyse de l'existant

| Sujet | Aujourd'hui |
|---|---|
| Stack | Supabase (Postgres 17, Auth, Storage, Edge Functions Deno) · admin Next.js 16 · mobile Expo SDK 57 (React Native) · tests node:test + supabase-js |
| Données | 18 tables (`docs/03b-supabase.md`) : `profiles`, `ebooks`, `ebook_files`, `cart_items`, `orders`, `order_items`, `payments`, `payment_events`, `entitlements`… |
| Authentification | Supabase Auth (e-mail + mot de passe, jetons courts, rafraîchissement rotatif) |
| Rôles | `profiles.role` = `CUSTOMER` ou `ADMIN`, vérifié côté serveur (`require_admin()`, RLS) |
| Modèle de vente | **Un seul vendeur** (le propriétaire) ; **uniquement des e-books** (EPUB lu dans l'app, PDF en téléchargement) ; prix en EUR |
| Paiement | Interface `PaymentProvider` (`supabase/functions/_shared/payments.ts`) : Stripe Checkout + prestataire factice ; webhook signé et idempotent ; l'accès n'est créé que par `svc_mark_paid` |
| Fichiers | Bucket privé `ebooks`, URL signées de 5 min ; bucket public `covers` |
| Paramètres admin | Table `settings` (clé `app`) éditée dans Admin → Paramètres, journalisée dans `audit_logs` |

**Ce que les nouvelles fonctionnalités changent en profondeur** : on passe d'une boutique à une **place de marché** (CDC §4 l'excluait explicitement), avec des **produits physiques** (stock, livraison) et des **flux d'argent vers des tiers** (reversements aux vendeurs). Ces deux points ont des conséquences juridiques et opérationnelles (§6).

## 2. Modèle de données (migrations)

**Produits** : la table `ebooks` devient `products` (renommage, et une vue `ebooks` garde la compatibilité le temps de la transition).

| Table / colonne | Rôle |
|---|---|
| `products.seller_id` → `profiles` | Vendeur. Les e-books existants sont rattachés au compte propriétaire (question Q8) |
| `products.kind` `PHYSICAL` \| `DIGITAL` | Obligatoire, non modifiable après la première vente |
| `products.language`, `currency` | Langue du livre ; devise du prix (Q3) |
| `products.condition` `NEW` \| `VERY_GOOD` \| `GOOD` \| `WORN` | Physique uniquement (contrainte `check`) |
| `products.stock` | Physique uniquement, ≥ 0 ; décrémenté atomiquement au paiement |
| `products.status` `DRAFT` \| `PENDING_REVIEW` \| `ACTIVE` \| `PAUSED` \| `ARCHIVED` | Pause et suppression par le vendeur ; `PENDING_REVIEW` si modération (Q4) |
| `product_shipping_options` | Modes de livraison par produit : `mode` (remise en main propre, envoi postal, livreur…), `price_cents`, `zone` (pays), `delay_days` |
| `shipping_addresses` | Adresses de l'acheteur |
| `order_items` + `seller_id`, `kind`, `quantity`, `shipping_option_id`, `shipping_cents` | Une commande peut contenir plusieurs vendeurs (Q9) |
| `shipments` | Par commande et par vendeur : `status` `TO_SHIP` → `SHIPPED` → `DELIVERED` (ou `CANCELED`), adresse figée, suivi |
| `seller_payout_accounts` | `kind` `BANK` \| `MOBILE_MONEY`, `country`, `operator`, `holder_name`, **`secret_ciphertext`** (IBAN ou numéro chiffré AES-256-GCM), `last4`, `is_default` |
| `seller_earnings` | Grand livre : par ligne vendue → `gross`, `commission`, `net`, `status` `PENDING` → `AVAILABLE` → `PAID_OUT`, `available_at` |
| `payouts` | Reversements : vendeur, compte, montant, `status`, référence prestataire |
| `payments` + `method` (`CARD` \| `MOBILE_MONEY`), `country`, `operator`, `msisdn_last4` | Le numéro complet n'est pas conservé après la transaction |
| `payment_settings_log` | Historique des activations / désactivations : `actor_id`, `before`, `after`, `at` |
| `settings` clé `mobile_money` | `{ enabled, countries: { KM: { enabled, operators: { HURI_MONEY, MVOLA_KM } }, MG: { enabled, operators: { MVOLA, ORANGE_MONEY, AIRTEL_MONEY } } } }` |

Règles RLS : un vendeur lit et modifie **ses** produits, ventes, gains et comptes de paiement ; il ne voit jamais les données de paiement d'un acheteur ni les coordonnées complètes d'un autre vendeur. Les écritures sensibles (commandes, droits, gains, reversements) restent réservées aux fonctions serveur, comme aujourd'hui.

## 3. API

**Fonctions SQL (RPC)**
- Catalogue : `search_products(q, category, kind, sort, page)` (filtre physique / numérique), `product_detail`, `catalog_home`.
- Vendeur : `seller_products`, `seller_save_product`, `seller_set_product_status(pause|activate|archive)`, `seller_delete_product` (seulement si jamais vendu), `seller_dashboard(period)` (en vente, vendus, gains en attente / disponibles / versés), `seller_shipments`, `seller_mark_shipped`.
- Acheteur : `my_addresses`, `save_address`, `my_physical_orders`, `confirm_delivery`.
- Admin : `admin_get_payment_settings`, `admin_set_payment_settings` (journalise dans `payment_settings_log`), `admin_payment_settings_log`, `admin_listings` (modération), `admin_payouts`.
- Public : `public_config` renvoie seulement les pays et opérateurs Mobile Money **actuellement actifs**.

**Fonctions Edge**
- `checkout` (étendue) : vérifie stock et livraison ; selon `method` → `CARD` (Stripe) ou `MOBILE_MONEY` (refusé si désactivé **au moment de la création**). Une commande déjà créée reste traitée même si Mobile Money est coupé ensuite.
- `payment-webhook?provider=…` : une route par prestataire, signature vérifiée, idempotence inchangée. À la confirmation : commande `PAID`, stock décrémenté, droits créés pour le numérique, expéditions créées pour le physique, lignes de gains créées.
- `payment-status` : interrogation du statut (Mobile Money), pour l'écran « Confirmez sur votre téléphone ».
- `seller-files` : envoi du PDF/EPUB par le vendeur (même contrôle que l'admin, plus vérification de propriété).
- `payout-accounts` : création et lecture **masquée** des coordonnées ; chiffrement avec `PAYOUT_ENCRYPTION_KEY`, jamais en clair dans la base ni dans les journaux.
- `payouts` (cron) : verse les gains `AVAILABLE` sur le compte par défaut (Mobile Money si l'option est active ; virement bancaire : export ou prestataire, Q7).

**Couche paiement** (`_shared/payments/`)
```ts
interface PaymentProvider { name; createSession(); parseWebhook(); refund() }            // existant, carte
interface MobileMoneyProvider {
  name; countries; operators;
  initiate({ reference, amount, currency, msisdn, operator }): Promise<{ providerRef, status: 'PENDING' }>;
  getStatus(providerRef): Promise<'PENDING' | 'SUCCEEDED' | 'FAILED'>;
  parseCallback(raw, headers): Promise<WebhookEvent>;        // signature vérifiée
  payout({ reference, amount, currency, msisdn, operator }): Promise<{ providerRef }>;
}
```
Implémentations : `FakeMobileMoney` (simulation : le paiement réussit après quelques secondes, un numéro finissant par `0000` échoue, une page de test permet de « confirmer sur le téléphone ») ; puis un adaptateur par agrégateur ou opérateur une fois les contrats et clés obtenus. Clés uniquement en variables d'environnement (`supabase secrets set`).

## 4. Écrans

**Mobile**
- Compte → **Espace vendeur** : tableau de bord (en vente, vendus, gains), Mes annonces (créer, modifier, pause, supprimer), Mes expéditions (à expédier / expédiées), Moyens de réception (IBAN/RIB, Mobile Money, affichés `****1234`).
- **Formulaire d'annonce dynamique** : choix obligatoire « Livre physique » / « Livre numérique » en premier ; champs communs ; puis état, stock et modes de livraison, **ou** envoi du fichier PDF/EPUB.
- Catalogue : filtre « Physique / Numérique », **badge** sur chaque carte et fiche ; fiche physique avec état, stock et livraison.
- Paiement : choix du moyen (carte, Mobile Money si actif) ; Mobile Money → pays, opérateur, numéro → écran « Confirmez le paiement sur votre téléphone » (interrogation du statut) ; adresse de livraison pour le physique.
- Ma bibliothèque : inchangée pour le numérique ; nouvel onglet **Mes commandes physiques** (suivi, « J'ai bien reçu »).

**Admin**
- Paramètres → **Mobile Money** : interrupteur général, interrupteurs par pays et par opérateur, historique (qui, quand, avant → après).
- **Annonces** (modération si Q4 = oui), **Vendeurs**, **Versements**.

## 5. Étapes

1. Commit du travail Supabase en cours (107 fichiers non sauvegardés).
2. Migration produits / vendeurs + RLS + tests d'accès (un vendeur ne touche pas aux annonces d'un autre).
3. Espace vendeur (annonces, formulaire dynamique, fichiers) + filtre et badges.
4. Livres physiques : stock atomique, livraison, expéditions, confirmation de réception.
5. Commandes multi-vendeurs, commission et grand livre des gains.
6. Coordonnées de paiement chiffrées et masquées.
7. Mobile Money : abstraction, simulation, `checkout` / `payment-webhook` / `payment-status`, écrans.
8. Réglages admin Mobile Money + historique.
9. Reversements (simulation) + tableau de bord vendeur complet.
10. Tests, mise à jour des documents (cadrage, recette, mise en production), déploiement.

**Tests prévus** : paiement Mobile Money (succès, échec, callback en double, callback falsifié, callback tardif), stock (deux achats simultanés du dernier exemplaire), Mobile Money désactivé (option invisible et refusée côté serveur, paiement en cours honoré), réglages refusés à un non-admin, historique écrit, accès aux livres numériques (seul l'acheteur, lien expiré, vendeur d'un autre livre refusé), chiffrement (la base ne contient jamais l'IBAN en clair), commissions et gains.

## 6. Points d'attention

- **Encaisser pour le compte de tiers et reverser** est une activité réglementée (prestataire de services de paiement, agrément de la banque centrale aux Comores et à Madagascar, DSP2 dans l'UE). En général, on passe par un agrégateur ou un PSP qui porte cette responsabilité. À valider avec un juriste avant la production.
- **Droits d'auteur** : n'importe quel utilisateur pourra déposer un PDF ou un EPUB. Sans modération ni procédure de retrait, le risque de piratage est réel.
- **Règles des stores** : la vente de **livres physiques** échappe aux achats intégrés Apple et Google, et Mobile Money y est autorisé. Pour les **livres numériques**, la question du §2 de `01-cadrage.md` reste entière.
- **Devises** : Mobile Money encaisse en francs comoriens (KMF) et en ariary (MGA), alors que les prix sont aujourd'hui en EUR.
- **Opérateurs** : les API marchandes (paiement et surtout **décaissement** vers un numéro) demandent un contrat avec chaque opérateur ou un agrégateur. Je n'ai pas vérifié leur disponibilité actuelle pour Huri Money et Mvola Comores.

## 7. Questions (réponses nécessaires avant de coder)

1. **Commission** de la plateforme : quel pourcentage, et prélevée sur quoi (prix seul, ou prix + livraison) ?
2. **Flux d'argent** : la plateforme encaisse tout puis reverse ? Délai de reversement : numérique immédiat ou après X jours ; physique après confirmation de réception ?
3. **Devises** : quelles devises proposer (EUR, KMF, MGA) ? Chaque vendeur choisit-il la sienne ? Une conversion est-elle nécessaire ?
4. **Modération** : faut-il valider chaque annonce avant publication, au moins pour les livres numériques ?
5. **Livraison** : quels modes (main propre, poste, livreur) ? Qui fixe les frais (le vendeur, par mode) ? Quelles zones ? Que se passe-t-il en cas de litige ou de colis non reçu ?
6. **Mobile Money** : as-tu déjà un contrat ou un agrégateur ? Lequel ? Les reversements par Mobile Money sont-ils prévus dans ce contrat ?
7. **Virements bancaires** aux vendeurs : faits à la main par l'admin à partir d'un export, ou via un prestataire ?
8. Les **e-books actuels** de l'admin deviennent-ils les annonces d'un vendeur « Folio » ?
9. **Panier multi-vendeurs** autorisé, ou un vendeur par commande ?
10. **Vérification d'identité** des vendeurs (KYC) avant de recevoir de l'argent ?

## 8. Décisions du propriétaire (23 octobre 2026)

| # | Décision | Mise en œuvre |
|---|---|---|
| 1 | Commission sur le **prix seul** | 2 % par défaut, réglable dans Admin → Paramètres (`commissionPercent`) ; les frais de livraison reviennent entièrement au vendeur |
| 2 | Vendeur payé **tout de suite** | Les gains passent « disponibles » dès la confirmation du paiement ; versement automatique en Mobile Money (simulé tant que l'agrégateur n'est pas branché), virement bancaire fait par l'admin |
| 3 | **Devises EUR, KMF, MGA**, choisies par le vendeur | Pas de conversion : un panier ne contient qu'une devise ; Mobile Money proposé seulement si la devise correspond au pays (KMF ↔ Comores, MGA ↔ Madagascar) ; carte pour l'EUR |
| 4 | **Pas de modération** | Publication directe ; l'admin peut archiver (retirer) n'importe quelle annonce |
| 5 | **Litiges** tranchés par l'admin | L'admin peut rembourser ; si le vendeur a déjà été payé, une ligne de gain négative (dette) est imputée sur ses gains suivants |
| 6 | Agrégateur Mobile Money **pas encore branchable** | Mode simulation complet ; adaptateur réel à ajouter plus tard derrière `MobileMoneyProvider` |
| 7 | Virements **bancaires manuels** | Admin → Versements : liste des sommes dues, IBAN déchiffré pour l'admin seul (journalisé), bouton « Marquer comme versé » |
| 8 | « Ça dépend » | Les e-books actuels restent des livres **de la plateforme** (`seller_id` vide, sans commission) ; l'admin peut continuer à en créer |
| 9 | Panier **multi-vendeurs** ; un livre numérique s'achète par un nombre illimité de clients, chacun sa copie | Commande découpée par vendeur (expéditions et gains séparés) ; un acheteur prend un exemplaire par livre |
| 10 | Pas de vérification d'identité | — |

Choix technique : la table `ebooks` est conservée (elle représente désormais tout « livre ») et reçoit `seller_id`, `kind`, `language`, `condition`, `stock` ; pas de renommage pour ne pas casser l'existant.

## 9. Mise en œuvre (23 octobre 2026)

**Migrations** : `20261023000001_marketplace_enums.sql` (types) et `20261023000002_marketplace.sql` (colonnes vendeur, type, langue, état et stock sur `ebooks` ; tables `ebook_shipping_options`, `shipping_addresses`, `shipments`, `seller_payout_accounts`, `seller_earnings`, `payouts`, `payment_settings_log` ; RLS ; fonctions vendeur, acheteur, admin et paiement).

**Fonctions Edge** : `checkout` (carte ou Mobile Money), `payment-webhook` (`?provider=mobile_money` pour les callbacks opérateur), `payment-status`, `fake-mobile-money` (simulation), `payout-accounts` (chiffrement AES-256-GCM), `seller` (fichiers et suppression), `payouts` (versements Mobile Money, appelée par pg_cron avec `x-cron-secret`), `admin` (action `reveal-payout-account`, journalisée).

**Variables d'environnement** (secrets des fonctions Edge) :

| Variable | Rôle |
|---|---|
| `MOBILE_MONEY_PROVIDER` | `fake` (simulation) tant que les contrats opérateurs ne sont pas signés |
| `FAKE_MM_SECRET` | Secret HMAC des callbacks simulés |
| `FAKE_MM_AUTO_CONFIRM_SECONDS` | Délai de confirmation automatique en simulation (`-1` = jamais) |
| `PAYOUT_ENCRYPTION_KEY` | 32 octets en base64 (`openssl rand -base64 32`) ; à sauvegarder : sans elle, les IBAN et numéros ne sont plus lisibles |
| `CRON_SECRET` | Déjà utilisé par `send-emails`, protège aussi `payouts` |

**Tâche planifiée à créer** : appel de `payouts` (par exemple toutes les heures) avec l'en-tête `x-cron-secret`, comme pour `send-emails`.

**Tests** : `supabase/tests/marketplace.test.mjs` (17 tests : vente, filtre, Mobile Money, interrupteurs admin, stock concurrent, accès aux livres numériques, chiffrement, commission, versements, remboursement).
