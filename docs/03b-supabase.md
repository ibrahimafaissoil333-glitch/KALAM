# Architecture Supabase (remplace l'API NestJS)

Depuis octobre 2026, le backend de Folio est **entièrement dans Supabase**. L'application mobile et l'administration parlent directement à Supabase. Les règles de sécurité de [03-conception-technique.md](03-conception-technique.md) restent valables ; seule leur mise en œuvre change.

```
 App mobile (Expo) ─┐                ┌─ Postgres : tables + règles RLS + fonctions SQL (RPC)
                    ├─ supabase-js ──┼─ Auth : comptes, sessions, réinitialisation
 Admin (Next.js) ───┘                ├─ Storage : « covers » (public), « ebooks » (privé)
                                     └─ Edge Functions (Deno) : paiement, webhook, lecture, admin
 Prestataire de paiement ── webhook signé ──▶ Edge Function payment-webhook
```

| Ancien (NestJS) | Nouveau (Supabase) |
|---|---|
| `POST /auth/*` (JWT maison, argon2) | **Supabase Auth** : mot de passe ≥ 8 caractères avec lettres et chiffres, jeton d'accès de 15 min, rafraîchissement rotatif, lien de réinitialisation PKCE (`folio://reset?code=…`) |
| Contrôleurs catalogue, panier, compte | **Fonctions SQL** `search_ebooks`, `catalog_home`, `ebook_detail`, `cart_*`, `my_*`, `save_progress`, `register_device`… |
| Contrôleurs admin | Fonctions SQL `admin_*`, chacune commence par `require_admin()` |
| `POST /orders`, webhook, page de test | **Edge Functions** `checkout`, `payment-webhook`, `fake-checkout` |
| Lecture / téléchargement | Edge Function `library` (droit vérifié, accès journalisé, URL signée de 5 min) |
| Envoi EPUB, remboursement, anonymisation | Edge Function `admin` |
| Suppression de compte | Edge Function `account` (mot de passe vérifié) |
| E-mails (nodemailer) | Table `email_outbox` remplie par la base, envoyée par la fonction `send-emails` (Resend), appelée chaque minute par pg_cron |
| Tâche « commandes abandonnées » | `pg_cron` → `cancel_stale_orders()` toutes les 5 min |

## Règles de sécurité appliquées

- **RLS activé sur toutes les tables.** Les clients n'ont que des droits de lecture limités à leurs propres lignes (commandes, droits, progression…). **Aucune policy d'écriture** n'existe sur `orders`, `payments`, `entitlements` : seules les Edge Functions (clé `service_role`) y écrivent, via les fonctions `svc_*`, qui ne sont pas exécutables par les clients.
- **Un droit d'accès n'est créé que dans `svc_mark_paid`**, appelée uniquement par `payment-webhook` après vérification de la signature. L'idempotence repose sur une clé unique par événement (`payment_events`).
- **Rôle admin** : colonne `profiles.role`, impossible à modifier par un client (pas de policy d'écriture, et les métadonnées utilisateur sont ignorées). Toutes les fonctions `admin_*` vérifient le rôle.
- **Compte suspendu** : toutes les fonctions client appellent `current_active_uid()`, qui refuse les comptes non actifs.
- **Stockage** : le bucket `ebooks` n'a aucune policy client ; les fichiers ne sortent que par des URL signées de 5 minutes émises par `library`. Le bucket `covers` est public (images marketing).
- **Paiement factice** désactivé en production (`PAYMENT_PROVIDER=stripe`, `FAKE_CHECKOUT_ENABLED=false`).

**Différence avec l'ancienne API** : le verrouillage d'un compte après 5 mots de passe faux (CA-10) est remplacé par la **limitation de débit de Supabase Auth** (30 tentatives par 5 min et par IP). Pour aller plus loin : CAPTCHA (hCaptcha / Turnstile) dans Auth → Attack protection.

## Développement local

```bash
brew install supabase/tap/supabase colima docker
colima start --cpu 4 --memory 6
supabase start -x imgproxy,supavisor        # API sur http://127.0.0.1:54321, Studio sur :54323
cp supabase/functions/.env.example supabase/functions/.env   # puis PAYMENT_PROVIDER=fake, secrets locaux
cd supabase/tests && npm install && npm test   # 30 tests (efface la base locale)
npm run seed                                   # données de démo + comptes SEED_* (tests/.env)
```

Les e-mails locaux (réinitialisation de mot de passe) sont visibles dans Mailpit : http://127.0.0.1:54324.

## Déploiement sur le projet en ligne

Projet : `https://tijgutdfavkfmerorkjq.supabase.co` (« kalam », région eu-west-1).

**État au 6 octobre 2026** : migrations, réglages Auth et 8 fonctions déployés.
- **Paiement désactivé** tant que Stripe n'est pas configuré (`PAYMENT_PROVIDER=fake`, `FAKE_CHECKOUT_ENABLED=false`, secret de webhook aléatoire) : aucun achat possible, aucun accès gratuit.
- **Confirmation d'e-mail à l'inscription désactivée** (inscription immédiate, comme dans l'app). À réactiver avec un SMTP configuré si le propriétaire le décide.
- **Double authentification TOTP** disponible (décision D13).
- Reste à faire : compte admin, contenus réels, clés Stripe, SMTP, cron d'envoi des e-mails (étapes ci-dessous).

```bash
supabase login                                   # une fois, ouvre le navigateur
supabase link --project-ref tijgutdfavkfmerorkjq # demande le mot de passe de la base
supabase db push                                 # applique les migrations (tables, RLS, fonctions, buckets, cron)
supabase config push                             # règles Auth (mot de passe, URL de retour, durée des jetons)
supabase secrets set PAYMENT_PROVIDER=stripe STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… \
  CHECKOUT_RETURN_URL=folio://checkout/return CHECKOUT_RETURN_PREFIXES=folio:// \
  FAKE_CHECKOUT_ENABLED=false MAIL_DRIVER=resend RESEND_API_KEY=… MAIL_FROM="Folio <no-reply@…>" CRON_SECRET=…
supabase functions deploy
```

Puis, dans le tableau de bord Supabase :
1. **Créer le compte admin** (Authentication → Add user), puis dans l'éditeur SQL : `update profiles set role = 'ADMIN' where email = '…';`.
2. **Webhook Stripe** vers `https://tijgutdfavkfmerorkjq.supabase.co/functions/v1/payment-webhook`.
3. **Envoi des e-mails chaque minute** (éditeur SQL, avec pg_net) :
   ```sql
   select cron.schedule('folio-send-emails', '* * * * *', $$
     select net.http_post('https://tijgutdfavkfmerorkjq.supabase.co/functions/v1/send-emails',
       headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>'))$$);
   ```
4. **SMTP d'Auth** (Authentication → Emails → SMTP) pour les e-mails de réinitialisation à votre nom.

Clés publiques à mettre dans les apps : `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY` (mobile), `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` (admin). La clé `sb_publishable_…` est publique par conception ; la clé secrète (`service_role`) ne doit **jamais** quitter le serveur.
