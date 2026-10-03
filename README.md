# KALAM — Folio

Application mobile (iPhone + Android) de vente et de lecture d'e-books vendus directement par leur propriétaire, avec une administration web.

| Dossier | Contenu | Technologies |
|---|---|---|
| [`api/`](api) | API REST `/v1`, base de données, paiement, stockage privé, e-mails | NestJS 12, Prisma 7, PostgreSQL 17 |
| [`admin/`](admin) | Administration web | Next.js 16 |
| [`mobile/`](mobile) | Application mobile | Expo SDK 57 (React Native) |
| [`docs/`](docs) | Documents de toutes les phases | — |

## Documents
1. [Cadrage et décisions](docs/01-cadrage.md) — décisions à prendre, paiement et stores, règles de gestion, MVP, critères d'acceptation, **questions au propriétaire**
2. [UX/UI](docs/02-ux-ui.md) et [tokens de design](docs/design-tokens.json)
3. [Conception technique](docs/03-conception-technique.md) et [contrat OpenAPI](docs/openapi.json)
4. Code : `api/`, `admin/`, `mobile/`
5. [Recette et tests](docs/05-recette.md)
6. [Mise en production](docs/06-mise-en-production.md), [guide administrateur](docs/guide-administrateur.md), [guide utilisateur](docs/guide-utilisateur.md)
7. [Maintenance et évolutions](docs/07-maintenance.md)

## Démarrer en local (macOS)

Prérequis : Node 22+, PostgreSQL 17 (`brew install postgresql@17 && brew services start postgresql@17`), Xcode pour le simulateur iPhone.

```bash
# 1. API (http://localhost:3000/v1, documentation sur /docs)
cd api
cp .env.example .env            # puis renseigner les secrets et DATABASE_URL
createdb folio_dev
npm install
npx prisma migrate deploy
npm run seed                    # 6 e-books de démo + comptes SEED_* du .env
npm run dev

# 2. Administration (http://localhost:3001)
cd admin && npm install && npm run dev

# 3. Application mobile (simulateur iPhone)
cd mobile && npm install && npx expo start --ios
```

En développement, le paiement utilise le **prestataire de test** intégré. La page « Payer / Simuler un refus » envoie un vrai webhook signé : aucun paiement réel n'est effectué. En production, `PAYMENT_PROVIDER=stripe`.

## Tests

```bash
createdb folio_test   # une seule fois
cd api && npm test    # 32 tests : critères d'acceptation, sécurité, paiement
```

## Règles absolues
- L'accès à un e-book n'est activé **qu'après le webhook signé du prestataire**, jamais depuis l'app.
- Aucune donnée bancaire n'est stockée.
- Les fichiers sont en stockage privé, servis uniquement par des URL signées de 5 minutes.
- Tout ce que le cahier des charges marque « à définir » est un paramètre : variable d'environnement ou Admin → Paramètres.
