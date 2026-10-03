# Phase 1 — Cadrage et décisions

Projet : application **Folio** (dépôt KALAM). Mobile Android + iPhone pour vendre et lire des e-books vendus directement par leur propriétaire, plus une administration web.

Sources : cahier des charges (CDC), PDF UX/UI, prototype V1 (`prtyp.html`), document « Analyse et prompts par phase ».

> Règle de ce document : tout ce que le CDC marque « à définir » reste un **paramètre configurable**. Aucun prix, délai ou règle commerciale n'est inventé. Chaque choix ci-dessous est une **recommandation** à valider par le propriétaire.

---

## 1. Décisions « à définir »

| # | Sujet | Options (avantages / inconvénients) | Recommandation | Impact si la décision tarde | Responsable |
|---|---|---|---|---|---|
| D1 | **Modèle de paiement** face aux stores | voir §2 | Paiement web externe via un prestataire à webhooks, encapsulé derrière une interface « prestataire » ; achat intégré (IAP) ajoutable sans refonte | **Bloquant** : conditionne l'architecture, le tunnel d'achat et la validation des stores | Propriétaire + technique + juridique |
| D2 | Prestataire de paiement | Stripe (webhooks signés, Checkout hébergé, test complet) / Mollie / PayPal / Lemon Squeezy (marchand de référence, gère la TVA) | Stripe Checkout en V1 ; un prestataire « marchand de référence » si la gestion de la TVA UE doit être déléguée | Bloque la phase 4a (étape paiement) | Propriétaire + finance |
| D3 | Devise et prix | EUR seul / multidevise | EUR seul au MVP ; prix stocké en **centimes** + devise par e-book | Bloque l'affichage des prix (actuellement `[Prix]`) | Propriétaire |
| D4 | TVA produits numériques UE | voir §3.5 | Prix affichés TTC ; taux selon le pays de l'acheteur ; déléguer au prestataire si possible | Risque fiscal dès la première vente hors de France | Propriétaire + expert-comptable |
| D5 | Format des e-books | EPUB (texte recomposable, taille réglable, sommaire natif) / PDF (mise en page fixe, mauvais sur téléphone) / les deux | **EPUB** prioritaire ; PDF accepté en téléchargement seulement | Conditionne le lecteur et la phase 4c | Propriétaire + technique |
| D6 | Protection des fichiers | Aucune / URL signées + stockage privé / filigrane personnalisé (e-mail de l'acheteur) / DRM (Readium LCP, Adobe) | Stockage privé + URL signées courtes + cache hors ligne chiffré ; filigrane en V2 ; pas de DRM au MVP (coût, friction) | Conditionne stockage et lecteur | Propriétaire |
| D7 | Téléchargement du fichier brut | Autorisé / interdit / par e-book | **Réglage par e-book** (`downloadAllowed`), désactivé par défaut | Faible : paramètre | Propriétaire |
| D8 | Lecture hors ligne | Oui (chiffrée) / non | Oui, cache chiffré sur l'appareil, révocable | Moyen | Propriétaire |
| D9 | Nombre d'appareils | Illimité / N appareils | Paramètre global `MAX_DEVICES` (vide = illimité) | Faible : paramètre | Propriétaire |
| D10 | Limite de téléchargements | Illimitée / N par e-book | Paramètre global `MAX_DOWNLOADS_PER_BOOK` (vide = illimité) + journal `download_events` | Faible | Propriétaire |
| D11 | Remboursement | Manuel depuis l'admin / automatique / jamais | Manuel depuis l'admin ; l'accès est **retiré** au remboursement | Moyen : à trancher avant la production | Propriétaire + juridique |
| D12 | Produit dépublié déjà acheté | Accès conservé / retiré | **Accès conservé** pour les acheteurs ; plus de nouvel achat | Faible | Propriétaire |
| D13 | Seconde étape de vérification admin | Aucune / TOTP / e-mail | TOTP (application d'authentification) | Moyen (sécurité admin) | Propriétaire |
| D14 | Notifications push | Oui / non au MVP | E-mails transactionnels au MVP ; push en V2 | Faible | Propriétaire |
| D15 | Prestataire e-mail | Postmark / Brevo / SES / SMTP | Brevo ou Postmark (UE) via une interface `Mailer` | Faible | Technique |
| D16 | Hébergement | Scaleway / OVH / AWS eu-west / Render | Hébergeur UE (RGPD), stockage S3 compatible | Moyen | Propriétaire + technique |
| D17 | Versions minimales OS | — | iOS 16+, Android 8 (API 26)+ ; à confirmer selon l'audience | Faible | Technique |
| D18 | Nom de l'application | « Folio » (maquettes) / « KALAM » (dépôt) | Nom paramétré (`APP_NAME`) ; « Folio » par défaut | Bloque la publication sur les stores | Propriétaire |
| D19 | Durée de conservation des données | — | Commandes : durée légale comptable ; comptes inactifs : à fixer | Bloque la politique de confidentialité | Propriétaire + juridique |
| D20 | Export CSV des commandes | Oui / non | Oui (sans donnée bancaire) | Faible | Propriétaire |

---

## 2. Modèle de paiement et règles des stores (priorité 1)

Les e-books sont des **contenus numériques consommés dans l'app**. Apple et Google imposent en principe leur propre système de paiement pour ce type d'achat, avec des exceptions qui **changent selon le pays et la période**. Les éléments ci-dessous sont des pistes à **vérifier dans les règles en vigueur au moment du lancement**. Ce document ne les présente pas comme acquises.

| Option | Avantages | Inconvénients |
|---|---|---|
| **A. Achat intégré** (Apple IAP / Google Play Billing) | Conforme partout par défaut ; confiance de l'utilisateur ; pas de saisie de carte | Commission des stores ; un produit par prix à déclarer dans chaque store ; remboursements gérés par les stores ; deux intégrations distinctes ; l'admin ne fixe plus librement les prix |
| **B. Paiement web externe** (prestataire + page hébergée) | Commission du prestataire seulement ; prix libres ; un seul backend ; webhooks fiables | **Pas autorisé partout** pour du contenu numérique consommé dans l'app ; risque de rejet en revue |
| **C. Hybride** | IAP là où c'est obligatoire, web là où c'est permis ; ou modèle « app de lecture » : achat sur le site, lecture dans l'app | Plus de code, deux sources de commande à réconcilier |

**Recommandation** : architecture **C prête dès le départ**. Le backend gère une interface `PaymentProvider` (création de session, vérification de webhook), avec une implémentation web (Stripe) au MVP. L'app mobile lit un réglage serveur `checkoutMode` par plateforme et par pays :

- `external` : bouton « Payer » qui ouvre la page de paiement hébergée, puis retour par lien profond ;
- `web_only` : modèle « app de lecture », l'app n'affiche ni prix ni bouton d'achat, l'achat se fait sur le site ;
- `iap` : réservé à une V2 si nécessaire.

**À vérifier pays par pays avant le lancement (France/UE en premier) :**

1. **UE (DMA)** : conditions d'Apple pour les liens de paiement externes et les prestataires alternatifs (droit, commission, écran d'avertissement, éligibilité) ; programme de facturation alternative de Google Play dans l'EEE.
2. **App Store, guideline 3.1.3(a) « Reader apps »** : une app de lecture peut-elle proposer un lien externe de gestion de compte ? Avec quel droit (entitlement) ?
3. **États-Unis** : état actuel des liens d'achat externes sur l'App Store et Google Play, après les décisions judiciaires récentes.
4. **Autres pays visés** (Corée du Sud, Japon, etc.) : règles locales.
5. Pour chaque pays : texte exact de l'écran d'information imposé, commission due et obligation de déclaration.

Si aucune exception ne s'applique dans un pays, ce pays passe en `web_only` : l'app reste utilisable pour la lecture.

---

## 3. Règles de gestion

1. **Activation de l'accès** : un droit (`entitlement`) est créé **uniquement** par le traitement d'un webhook signé du prestataire. Le retour de l'app ou du navigateur ne vaut jamais confirmation. Tant que le webhook n'est pas reçu, la commande reste `PENDING` (« en vérification »).
2. **Statuts de commande** : `PENDING` → `PAID` | `FAILED` | `CANCELED` ; `PAID` → `REFUNDED`. Aucune autre transition.
3. **Remboursement** (D11) : déclenché depuis l'admin (ou reçu par webhook). L'effet est `REFUNDED`, le droit est révoqué (`revokedAt`), le cache hors ligne de l'appareil est invalidé à la prochaine synchronisation et un e-mail est envoyé au client.
4. **Téléchargements** (D7, D10) : uniquement si `downloadAllowed`. URL signée valable `SIGNED_URL_TTL_SECONDS` (300 s par défaut). Chaque URL émise est journalisée. Si `MAX_DOWNLOADS_PER_BOOK` est défini, une erreur 429 explicite est renvoyée une fois la limite atteinte.
5. **Appareils** (D9) : chaque appareil s'enregistre à la connexion. Au-delà de `MAX_DEVICES`, le client doit retirer un appareil depuis son compte.
6. **Produit dépublié** (D12) : il disparaît du catalogue et ne peut plus être ajouté au panier ni acheté, mais il reste lisible pour les détenteurs d'un droit. Archiver revient à dépublier, et la suppression n'est possible que si le produit n'a jamais été vendu.
7. **TVA UE** (D4) : les prix saisis sont TTC. Le taux applicable est celui du **pays de l'acheteur** (règles du guichet unique OSS pour les services électroniques B2C). Au MVP, le calcul est délégué au prestataire (Stripe Tax ou marchand de référence). L'API conserve le montant HT, la TVA et le pays sur la commande. Le seuil et l'immatriculation OSS sont à valider avec un expert-comptable.
8. **Panier** : un e-book au plus une fois, quantité 1, et pas d'ajout si l'utilisateur le possède déjà. À la connexion, le panier invité est fusionné avec le panier du compte.
9. **Prix** : le prix figé est copié sur la ligne de commande au moment de la création. Un changement de prix ultérieur n'affecte pas les commandes en cours.
10. **Idempotence** : chaque webhook est enregistré par son identifiant d'événement, et un doublon est ignoré. La création de session accepte un en-tête `Idempotency-Key`.
11. **RGPD** : le client peut exporter ses données (JSON) et supprimer son compte. La suppression anonymise l'utilisateur mais conserve les commandes, obligation comptable : les e-mails et noms sont effacés. Le consentement marketing est optionnel, horodaté et révocable.
12. **Mot de passe** : au moins 8 caractères, dont au moins une lettre et un chiffre. Le lien de réinitialisation est à usage unique et valable `RESET_TOKEN_TTL_MINUTES` (30 min par défaut).

---

## 4. Périmètre MVP (CDC §19.1)

**Inclus :**
accueil, catalogue, recherche insensible aux accents, filtres par catégorie, tris (Nouveautés, Titre, Auteur) ; fiche avec extrait gratuit ; inscription, connexion, mot de passe oublié ; panier conservé et fusionné ; paiement via un prestataire à webhooks, avec les statuts confirmée, échouée, en vérification et remboursée ; bibliothèque (onglets, recherche, hors ligne) ; lecteur (sommaire, taille du texte, progression synchronisée) ; compte (commandes, notifications, informations, sécurité, aide, conditions, suppression) ; administration (tableau de bord, e-books, commandes, utilisateurs, statistiques de base, paramètres) ; e-mails transactionnels.

**Hors périmètre explicite :**
produits physiques et stock ; place de marché multivendeurs ; publication vers des plateformes externes ; favoris, avis, codes promo, abonnements, annotations ; notifications push ; multidevise et internationalisation (interface en français uniquement) ; DRM ; achat intégré aux stores (préparé, non implémenté).

---

## 5. Critères d'acceptation (Étant donné / Quand / Alors)

**Catalogue**
- *CA-01* Étant donné 6 e-books publiés et 1 brouillon, quand un visiteur ouvre le catalogue, alors il voit 6 e-books et le compteur affiche « 6 e-books ».
- *CA-02* Étant donné le catalogue, quand le visiteur cherche « ines » (sans accent), alors « L'Art de ralentir » d'Inès Morel apparaît.
- *CA-03* Étant donné une recherche sans résultat, alors l'écran « Aucun e-book ne correspond » s'affiche avec le bouton « Effacer la recherche et les filtres ».
- *CA-04* Quand le visiteur choisit le tri « Titre A → Z », alors les résultats sont triés par titre selon l'ordre alphabétique français.

**Fiche**
- *CA-05* Étant donné un e-book publié, quand le visiteur ouvre sa fiche, alors il voit la couverture, le titre, l'auteur, la catégorie, la description et le prix configuré.
- *CA-06* Quand un visiteur non connecté touche « Lire un extrait gratuit », alors l'extrait s'ouvre sans compte, avec le bandeau « Extrait gratuit · Acheter ».
- *CA-07* Étant donné un e-book déjà acheté, alors la fiche affiche « Lire maintenant » et aucun bouton d'achat.

**Compte**
- *CA-08* Quand l'utilisateur s'inscrit avec le mot de passe « abcdefgh », alors l'inscription est refusée avec le message « une lettre et un chiffre ».
- *CA-09* Étant donné un mauvais mot de passe, quand l'utilisateur se connecte, alors il voit « E-mail ou mot de passe incorrect » sans indication sur l'existence du compte.
- *CA-10* Après 5 échecs de connexion en 15 min, les tentatives suivantes reçoivent une erreur 429.
- *CA-11* Quand l'utilisateur demande une réinitialisation, alors un e-mail contenant un lien à usage unique est envoyé. La réponse est identique, que le compte existe ou non.
- *CA-12* Étant donné un lien de réinitialisation déjà utilisé ou expiré, alors le nouveau mot de passe est refusé.

**Panier et paiement**
- *CA-13* Étant donné un panier invité de 2 e-books, quand l'utilisateur se connecte, alors son panier contient ces 2 e-books en plus de ceux qu'il avait déjà, sans doublon.
- *CA-14* Quand un client paie et que le prestataire envoie `payment.succeeded`, alors la commande passe `PAID` et les e-books apparaissent dans sa bibliothèque.
- *CA-15* Étant donné un retour de paiement dans l'app sans webhook reçu, alors l'écran « Paiement en vérification » s'affiche et aucun accès n'est accordé.
- *CA-16* Quand le prestataire envoie un échec, alors la commande passe `FAILED`, l'écran d'échec affiche les causes fréquentes et le panier est conservé.
- *CA-17* Quand le même webhook est reçu deux fois, alors un seul droit est créé et un seul e-mail est envoyé.
- *CA-18* Un webhook à la signature invalide reçoit une erreur 400 et ne modifie rien.

**Bibliothèque et lecture**
- *CA-19* Étant donné un client A propriétaire d'un e-book, quand un client B demande l'URL de lecture de cet e-book, alors il reçoit une erreur 403.
- *CA-20* Une URL signée expirée renvoie une erreur 403.
- *CA-21* Quand le client lit jusqu'à 40 % sur un appareil, alors un autre appareil reprend à 40 %.
- *CA-22* Étant donné une commande remboursée, alors l'e-book disparaît de la bibliothèque et l'URL de lecture renvoie une erreur 403.

**Administration**
- *CA-23* Un client qui appelle une route `/admin/*` reçoit une erreur 403.
- *CA-24* Quand l'admin crée un brouillon, ajoute le fichier et le publie, alors l'e-book apparaît dans le catalogue public.
- *CA-25* Quand l'admin dépublie un e-book, alors il disparaît du catalogue, mais les acheteurs le lisent toujours.
- *CA-26* Le chiffre d'affaires du tableau de bord est égal à la somme des commandes `PAID` de la période, remboursements exclus.
- *CA-27* Chaque publication, dépublication, remboursement ou changement de rôle ou de statut crée une entrée `audit_logs`.

---

## 6. Questions au propriétaire (par urgence)

**Bloquantes (avant le développement du paiement)**
1. Dans quels pays l'app sera-t-elle publiée au lancement ?
2. Quel prestataire de paiement, et acceptez-vous le modèle « achat sur le web » là où les stores l'exigent ?
3. Prix de chaque e-book et devise ?
4. Êtes-vous assujetti à la TVA ? Êtes-vous inscrit au guichet unique OSS ?
5. Nom définitif de l'application : Folio ou KALAM ?

**Avant la recette**
6. Format des fichiers (EPUB, PDF) et téléchargement du fichier brut autorisé ?
7. Règles de remboursement (délai, cas, qui décide) ?
8. Limite d'appareils et de téléchargements ?
9. Seconde étape de vérification pour l'admin ?
10. Adresse et délai du support client ?

**Avant la mise en production**
11. Hébergeur et budget mensuel ?
12. Comptes développeur Apple (99 $/an) et Google Play (25 $ une fois) au nom de qui ?
13. CGU, CGV, politique de confidentialité et mentions légales : qui les rédige et qui les valide ?
14. Durées de conservation des données ?
