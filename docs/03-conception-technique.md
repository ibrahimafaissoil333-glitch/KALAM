# Phase 3 — Conception technique

## 1. Architecture

```
 ┌──────────────┐  HTTPS/JSON   ┌──────────────────────────┐   SQL   ┌────────────┐
 │ App mobile   │ ───────────▶ │ API NestJS (TypeScript)  │ ──────▶ │ PostgreSQL │
 │ Expo / RN    │ ◀─────────── │  /v1  (OpenAPI)          │         └────────────┘
 └──────┬───────┘  JWT 15 min   │                          │  S3 API ┌────────────┐
        │                       │  Storage ───────────────────────▶ │ Stockage   │
        │ URL signée (300 s)    │  PaymentProvider          │         │ privé (S3) │
        └──────────────────────────────────────────────────────────▶ └────────────┘
 ┌──────────────┐  cookie httpOnly│  Mailer                 │ webhook ┌────────────┐
 │ Admin Next.js│ ──(proxy)────▶ │                          │ ◀────── │ Prestataire│
 └──────────────┘                └──────────────────────────┘ signé    │ paiement   │
                                                                       └────────────┘
```

| Choix | Justification |
|---|---|
| **Expo + React Native + TypeScript** | Un seul code pour iOS et Android ; mises à jour OTA ; liens profonds et stockage sécurisé intégrés |
| **NestJS** | Modules, gardes de rôle, validation déclarative, génération OpenAPI ; adapté à une équipe |
| **Prisma + PostgreSQL** | Schéma typé, migrations versionnées, transactions pour l'idempotence |
| **Next.js (admin)** | Rendu web rapide ; les jetons restent côté serveur (cookies httpOnly + proxy) |
| **Stockage S3 privé** | URL signées à durée courte ; un pilote `local` signe ses URL par HMAC pour le développement |
| **PaymentProvider** | Interface unique : `stripe` (production), `fake` (développement et tests, webhooks signés HMAC) |

## 2. Flux de paiement

```
App            API                         Prestataire
 │ POST /orders (Idempotency-Key)            │
 │──────────▶│ Commande PENDING, prix figés  │
 │           │ createSession() ─────────────▶│
 │◀──────────│ { orderId, checkoutUrl }       │
 │ ouvre checkoutUrl (navigateur in-app)      │
 │─────────────────────────────────────────▶ │ paiement
 │                         webhook signé      │
 │           │◀──────────────────────────────│ payment.succeeded / failed
 │           │ 1. vérifie la signature (sinon 400)
 │           │ 2. INSERT payment_events(eventId) UNIQUE → doublon = 200 sans effet
 │           │ 3. TX : order PAID + entitlements + vidage du panier
 │           │ 4. e-mail « commande confirmée »
 │ retour folio://checkout/return?order=…     │
 │ GET /orders/:id (toutes les 3 s)           │
 │──────────▶│ PAID → Confirmation ; FAILED → Échec ; PENDING > 2 min → « en vérification »
```

| Cas | Traitement |
|---|---|
| Échec | Webhook `failed` → `FAILED` ; le panier n'est pas vidé |
| Interruption (navigateur fermé) | La commande reste `PENDING` ; l'app affiche « en vérification » ; une tâche passe en `CANCELED` après `ORDER_PENDING_TTL_MINUTES` sans webhook |
| Webhook en retard | L'app interroge ; e-mail envoyé à la réception |
| Webhook en double | Clé unique `payment_events.providerEventId` |
| Webhook désordonné (`failed` après `succeeded`) | Transitions autorisées uniquement depuis `PENDING` ; sinon ignoré et journalisé |
| Double clic « Payer » | `Idempotency-Key` → même commande renvoyée |
| Le client possède déjà un article | Refus 409 à la création |

## 3. Modèle de données

Voir `api/prisma/schema.prisma`. Tables : `users`, `refresh_tokens`, `password_resets`, `devices`, `categories`, `ebooks`, `files`, `carts`/`cart_items`, `orders`, `order_items`, `payments`, `payment_events`, `entitlements`, `download_events`, `reading_progress`, `notification_prefs`, `audit_logs`, `settings`, `ebook_views`.

Les rôles sont un enum `CUSTOMER | ADMIN` sur `users` (pas de table séparée au MVP).

**Statuts et transitions**

- E-book : `DRAFT → PUBLISHED ⇄ DRAFT` ; `* → ARCHIVED` ; la suppression n'est possible qu'en `DRAFT` sans vente.
- Commande : `PENDING → PAID | FAILED | CANCELED` ; `PAID → REFUNDED`.
- Paiement : `CREATED → SUCCEEDED | FAILED` ; `SUCCEEDED → REFUNDED`.
- Utilisateur : `ACTIVE ⇄ SUSPENDED` ; `* → DELETED` (anonymisé).
- Droit : actif tant que `revokedAt` est nul.

## 4. Contrat d'API
Généré depuis le code : `npm run openapi --prefix api` produit `docs/openapi.json` ; Swagger UI est disponible sur `/docs` hors production. Préfixe `/v1`.

| Domaine | Routes | Droit |
|---|---|---|
| Auth | `POST /auth/register, /login, /refresh, /logout, /forgot-password, /reset-password` | Public (rate limit) |
| Catalogue | `GET /catalog/ebooks, /catalog/ebooks/:slug, /catalog/ebooks/:slug/preview, /catalog/categories, /catalog/home` | Public |
| Panier | `GET/PUT /cart`, `POST /cart/items`, `DELETE /cart/items/:ebookId`, `POST /cart/merge` | Client |
| Commandes | `POST /orders`, `GET /orders`, `GET /orders/:id` | Client (propriétaire) |
| Webhook | `POST /webhooks/payment` | Signature du prestataire |
| Bibliothèque | `GET /library`, `GET /library/:ebookId/content`, `POST /library/:ebookId/download-url`, `PUT /library/:ebookId/progress` | Client + droit actif |
| Compte | `GET/PATCH /me`, `PUT /me/password`, `GET/PUT /me/notifications`, `GET /me/devices`, `DELETE /me/devices/:id`, `GET /me/export`, `DELETE /me` | Client |
| Fichiers | `GET /files/signed` (pilote local) | Signature HMAC + expiration |
| Admin | `/admin/ebooks*`, `/admin/orders*`, `/admin/users*`, `/admin/stats`, `/admin/settings`, `/admin/audit-logs` | ADMIN |
| Config | `GET /config` (mode de paiement par plateforme, liens légaux) | Public |

## 5. Sécurité
- **Authentification** : jeton d'accès JWT de 15 min ; jeton de rafraîchissement opaque de 30 jours, **rotatif**, stocké haché (SHA-256). Une réutilisation détectée révoque toute la famille de jetons.
- **Mots de passe** : argon2id ; règles de longueur et de composition.
- **Contrôle d'accès** : garde `JwtAuthGuard` + `RolesGuard` ; chaque requête de ressource filtre par `userId` (pas d'IDOR) ; la vérification du droit précède toute URL de fichier.
- **Limitation du débit** : global 120 req/min/IP ; auth 10 req/min ; verrouillage après 5 échecs de connexion par e-mail en 15 min.
- **URL signées** : `SIGNED_URL_TTL_SECONDS` = 300 s ; liées à l'objet, sans liste de répertoire.
- **Journal** (`audit_logs`) : connexions admin, publication/dépublication/archivage, remboursement, rôle/statut utilisateur, export RGPD, suppression de compte, changement de paramètres.
- **En-têtes** : Helmet, CORS limité aux origines configurées, corps JSON limité à 1 Mo (sauf téléversement : 100 Mo).
- **RGPD** : `GET /me/export` (JSON complet) ; `DELETE /me` (anonymisation, révocation des sessions, conservation des commandes pour la comptabilité).
- **Aucune donnée bancaire** : seuls l'identifiant de session ou de paiement du prestataire et le statut sont stockés.

## 6. Lecteur et hors ligne
- Format retenu : **EPUB**. À l'envoi, l'API extrait le sommaire et les chapitres (OPF + spine) en blocs texte (`h1/h2/p/blockquote`), stockés en JSON privé. L'app les affiche nativement : taille de texte, interligne, accessibilité et sommaire sont alors immédiats.
- L'extrait gratuit est généré à partir des N premiers blocs (`previewBlocks`, réglable par e-book).
- Le PDF n'est proposé qu'en téléchargement, si l'option est autorisée.
- **Hors ligne** : le contenu est chiffré en **AES-256-GCM** (`@noble/ciphers`) avec une clé par appareil stockée dans `expo-secure-store` (Keychain ou Keystore) ; le fichier chiffré est dans `documentDirectory`. Un droit révoqué supprime le fichier à la synchronisation suivante.
- La progression (`chapterIndex`, `blockIndex`, `percent`) est synchronisée par `PUT`. La règle « dernier écrit gagne » s'applique selon `updatedAt`.

## 7. Environnements, CI/CD, sauvegardes, supervision
- **dev** (PostgreSQL local, stockage `local`, paiement `fake`, e-mails en console) · **recette** (Stripe en mode test) · **production**.
- **CI** (GitHub Actions, `.github/workflows/ci.yml`) : installation, lint, compilation, tests unitaires et e2e de l'API sur un service PostgreSQL, compilation de l'admin et vérification des types du mobile.
- **CD** : image Docker de l'API et migrations `prisma migrate deploy` avant démarrage ; admin sur une plateforme Node ; mobile via EAS Build/Submit.
- **Sauvegardes** : PostgreSQL géré avec PITR ; sauvegarde quotidienne gardée 30 j ; versionnement du bucket ; **restauration testée** chaque trimestre.
- **Supervision** : `GET /health` (base de données et stockage) ; journaux JSON (pino) ; Sentry sur l'API, l'admin et le mobile ; alertes sur erreurs 5xx, webhooks rejetés et commandes `PENDING` de plus de 15 min.

## 8. Risques et parades

| Risque | Parade |
|---|---|
| Rejet par les stores pour cause de paiement externe | `checkoutMode` configurable par plateforme et pays ; mode `web_only` prêt |
| Accès accordé sans paiement | Droit créé uniquement dans le gestionnaire du webhook signé ; tests CA-14 à CA-18 |
| Fuite de fichiers | Stockage privé, URL de 300 s, journal des téléchargements, limites configurables, filigrane en V2 |
| Vol de jeton | Accès court, rotation et détection de réutilisation, révocation par appareil |
| TVA mal calculée | Délégation au prestataire ; montants HT, TVA et pays enregistrés |
| EPUB mal formé | Validation à l'envoi ; refus avec message clair ; aperçu admin avant publication |
| Perte de données | PITR, restauration testée, versionnement du bucket |
