# KALAM — Folio

Application mobile (iPhone + Android) de vente et de lecture d'e-books vendus directement par leur propriétaire, avec une administration web.

| Dossier | Contenu | Technologies |
|---|---|---|
| [`supabase/`](supabase) | Base de données, règles d'accès (RLS), fonctions SQL, fonctions Edge (paiement, lecture, admin), tests | Supabase (Postgres 17, Auth, Storage, Edge Functions) |
| [`admin/`](admin) | Administration web | Next.js 16 + supabase-js |
| [`mobile/`](mobile) | Application mobile | Expo SDK 57 + supabase-js |
| [`docs/`](docs) | Documents de toutes les phases | — |

## Documents
1. [Cadrage et décisions](docs/01-cadrage.md) — décisions à prendre, paiement et stores, règles de gestion, MVP, critères d'acceptation, **questions au propriétaire**
2. [UX/UI](docs/02-ux-ui.md) et [tokens de design](docs/design-tokens.json)
3. [Conception technique](docs/03-conception-technique.md) et **[architecture Supabase](docs/03b-supabase.md)** (déploiement inclus)
4. Code : `supabase/`, `admin/`, `mobile/`
5. [Recette et tests](docs/05-recette.md)
6. [Mise en production](docs/06-mise-en-production.md), [guide administrateur](docs/guide-administrateur.md), [guide utilisateur](docs/guide-utilisateur.md)
7. [Maintenance et évolutions](docs/07-maintenance.md)

## Démarrer en local (macOS)

```bash
# 1. Supabase local (Docker via colima)
brew install supabase/tap/supabase colima docker
colima start --cpu 4 --memory 6
supabase start -x imgproxy,supavisor
cp supabase/functions/.env.example supabase/functions/.env   # mode paiement « fake » pour le développement
cd supabase/tests && npm install && npm run seed && cd ../..

# 2. Administration (http://localhost:3001)
cd admin && npm install && npm run dev

# 3. Application mobile (simulateur iPhone)
cd mobile && npm install && npx expo start --ios
```

En développement, le paiement utilise le **prestataire de test** : la page « Payer / Simuler un refus » envoie un vrai webhook signé, aucun paiement réel n'est effectué. En production : Stripe ([03b-supabase.md](docs/03b-supabase.md)).

## Tests

```bash
cd supabase/tests && npm test   # 30 tests : critères d'acceptation, RLS, paiement, sécurité (efface la base locale)
```

## Règles absolues
- L'accès à un e-book n'est activé **qu'après le webhook signé du prestataire**, jamais depuis l'app.
- Aucune donnée bancaire n'est stockée.
- Les fichiers sont en stockage privé, servis uniquement par des URL signées de 5 minutes.
- Tout ce que le cahier des charges marque « à définir » est un paramètre : secret Supabase ou Admin → Paramètres.
