# Phase 5 — Recette et tests

Les critères d'acceptation CA-01 à CA-27 viennent de [01-cadrage.md](01-cadrage.md) §5.

## 1. Plan de test

| Type | Portée | Outil / méthode | Automatisé |
|---|---|---|---|
| Fonctionnel API | Auth, catalogue, panier, commandes, webhooks, bibliothèque, admin | `npm test --prefix api` (node:test + supertest, base `folio_test`) | Oui, 32 tests |
| Fonctionnel mobile | Parcours principal et cas limites (§2) | Manuel sur simulateur et appareils réels ; Maestro en V2 | Partiel |
| Fonctionnel admin | Création → publication, commandes, remboursement, RGPD | Manuel | Non |
| Sécurité | §3 | Tests API automatisés + revue manuelle + scan OWASP ZAP sur la recette | Partiel |
| Compatibilité | iOS 16 → dernière version ; Android 8 (API 26) → dernière version ; petit écran (iPhone SE, 375 pt), grand écran (Pro Max, 440 pt), Android 360 dp | Simulateurs + 2 appareils physiques minimum par plateforme | Non |
| Accessibilité | VoiceOver, TalkBack, texte à 200 %, contrastes, cibles de 44 pt | Manuel, grille WCAG 2.2 AA (docs/02-ux-ui.md §5) | Non |
| Performance | Catalogue < 1 s (p95 API < 300 ms), ouverture d'un livre < 2 s en 4G | k6 sur l'API, chronométrage sur l'appareil | Partiel |
| Hors ligne | Lecture d'un livre téléchargé en mode avion, progression mise en file puis synchronisée | Manuel | Non |

## 2. Scénarios de bout en bout

**E2E-01 Parcours principal** : accueil → fiche → ajouter au panier → panier → « Passer au paiement » → connexion (le panier est conservé) → paiement → page sécurisée « Payer » → confirmation (référence + date) → « Ouvrir ma bibliothèque » → lire → fermer → la progression est conservée.

| # | Cas limite | Étapes | Résultat attendu |
|---|---|---|---|
| E2E-02 | Paiement refusé | Page de test → « Simuler un refus de carte » | Écran d'échec avec les causes fréquentes, panier conservé, aucun e-book en bibliothèque, e-mail « paiement non abouti » |
| E2E-03 | Paiement interrompu | Page de test → « Fermer sans payer » | Écran « Paiement en vérification » ; commande `PENDING`, puis `CANCELED` après `ORDER_PENDING_TTL_MINUTES` |
| E2E-04 | Webhook en retard | Couper l'envoi du webhook, payer, l'envoyer 2 min plus tard | « En vérification », puis message d'attente prolongée ; à la réception, e-mail et bibliothèque mise à jour |
| E2E-05 | Webhook reçu deux fois | Rejouer le même événement | Un seul droit, un seul e-mail (test API CA-17) |
| E2E-06 | Session expirée pendant l'achat | Révoquer le jeton de rafraîchissement, puis payer | Retour à la connexion, panier conservé, reprise du paiement après connexion |
| E2E-07 | E-book dépublié après achat | Admin → Dépublier | Absent du catalogue, toujours lisible par l'acheteur (CA-25) |
| E2E-08 | Remboursement | Admin → commande → Rembourser | E-book retiré de la bibliothèque, fichier hors ligne effacé à la synchronisation suivante, e-mail envoyé (CA-22) |
| E2E-09 | Deux appareils | Lire jusqu'à 40 % sur A, ouvrir sur B | B reprend à 40 % (CA-21) ; si une limite d'appareils est définie, le 3e appareil est refusé avec un message |
| E2E-10 | Hors ligne | Télécharger un e-book, passer en mode avion | Bandeau « Hors ligne », seuls les livres téléchargés sont visibles et lisibles ; achat désactivé |
| E2E-11 | Mot de passe oublié | Demande → lien `folio://reset?token=…` → nouveau mot de passe | Connexion avec le nouveau mot de passe ; l'ancien lien est refusé |
| E2E-12 | Suppression du compte | Compte → Supprimer, mot « SUPPRIMER » + mot de passe | Déconnexion, données effacées, connexion impossible |

## 3. Tests de sécurité

| # | Attaque | Attendu | Couvert par |
|---|---|---|---|
| S-01 | Accès direct à une URL de fichier sans signature, signature falsifiée ou expirée | 403 | `security.test.ts` CA-20 |
| S-02 | Lire le contenu d'un e-book d'un autre compte | 403 | CA-19 |
| S-03 | Modifier l'identifiant de commande dans `GET /orders/:id` | 404 | CA-19 |
| S-04 | Élévation vers le rôle admin (champ `role` injecté, routes `/admin`) | 400 / 403 | CA-23 et test « élévation » |
| S-05 | Force brute sur la connexion | 429 après 5 échecs + limite de 10 requêtes/min/IP | CA-10 |
| S-06 | Injection SQL dans la recherche | Aucun effet (requêtes paramétrées Prisma) | test « injection » |
| S-07 | Webhook forgé ou rejoué au-delà de 5 min | 400 | CA-18 |
| S-08 | Injection de formule dans l'export CSV | Cellule neutralisée | test « CSV » |
| S-09 | CSRF sur l'admin | Les requêtes d'une autre origine sont refusées (403) ; cookies SameSite=Strict | Manuel |
| S-10 | Vol de jeton de rafraîchissement | Réutilisation détectée → famille révoquée | test « rotation » |
| S-11 | Énumération des comptes | Messages identiques à la connexion et à l'oubli de mot de passe | CA-09, CA-11 |

## 4. Criticité des anomalies

| Niveau | Définition | Exemples | Règle |
|---|---|---|---|
| **Bloquante** | Empêche un parcours du MVP, expose des données ou donne un accès non payé | Paiement impossible ; accès à un livre non acheté ; crash au lancement | 0 tolérée pour accepter la recette |
| **Majeure** | Parcours possible mais dégradé, ou exigence non respectée sans contournement simple | Progression non synchronisée ; e-mail de confirmation absent ; critère WCAG AA non respecté | 0 tolérée en production ; report possible si un contournement est validé par écrit |
| **Mineure** | Défaut visuel ou de confort | Alignement, faute de frappe, animation | Liste acceptée, corrigée dans la version suivante |

**Règle d'acceptation** : tous les critères CA-01 à CA-27 sont validés, avec 0 anomalie bloquante et 0 anomalie majeure ouverte (sauf report signé). Les tests automatisés passent en CI.

## 5. Jeux de données
- `npm run seed --prefix api` charge 6 e-books, 6 catégories, un compte admin et un compte client. Les identifiants de test sont dans `api/.env` (`SEED_*`).
- Les prix de démonstration (`DEMO_PRICE_CENTS`) sont des **valeurs de test**, pas des prix commerciaux.
- Pour la recette, utiliser Stripe en mode test et ses cartes de test publiées (refus, 3-D Secure, fonds insuffisants).

## 6. Suivi des anomalies

| ID | Date | Écran / route | Étapes | Attendu | Obtenu | Criticité | Statut | Responsable | Version corrigée |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | Ouverte / En cours / Corrigée / Vérifiée / Rejetée | | |

## 7. Modèle de procès-verbal de recette

> **Procès-verbal de recette — Folio version ___**
> Date : ___ · Environnement : recette (URL ___)
> Participants : ___ (propriétaire), ___ (équipe)
>
> Périmètre testé : critères CA-01 à CA-27, scénarios E2E-01 à E2E-12, tests S-01 à S-11.
> Appareils : ___
>
> Résultats : ___ critères validés sur 27 · anomalies ouvertes : ___ bloquante(s), ___ majeure(s), ___ mineure(s) (liste jointe).
>
> ☐ Recette **acceptée** · ☐ Acceptée **avec réserves** (liste et échéances jointes) · ☐ **Refusée** (motifs joints)
>
> Signatures : ___
