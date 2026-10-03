# Phase 2 — Finalisation UX/UI

Système visuel strict : voir [`design-tokens.json`](design-tokens.json). L'interface est en français.

## 1. Audit des écarts entre maquettes et prototype V1

| Écran | Écart | Correction dans l'app |
|---|---|---|
| Panier → Paiement → Confirmation | Pas de barre d'étapes | Composant `StepBar` (Panier · Paiement · Confirmation) sur les 3 écrans |
| Paiement | Pas d'écran « Paiement en vérification » | Écran `PaymentPending` : interrogation du serveur toutes les 3 s pendant 2 min, puis message « Nous vous écrirons dès la confirmation » |
| Échec | Pas de « causes fréquentes » | Liste : carte refusée, plafond atteint, authentification 3-D Secure abandonnée, connexion interrompue |
| Confirmation | Pas de date | Date et heure de la commande (`Intl` fr-FR) |
| Bibliothèque | Ni recherche ni onglets | Onglets Tous / En cours / Hors ligne + champ de recherche |
| Lecteur | Ni sommaire, ni réglage Tт, ni temps restant | Feuille « Sommaire » (chapitres EPUB), feuille « Affichage » (taille 15–27, interligne), « ≈ N min restantes » |
| Compte | Rubriques manquantes | Informations personnelles, Sécurité (mot de passe, appareils), Aide, Conditions, Supprimer mon compte, notification « Mises à jour d'e-books » |
| Inscription | Règle, lien et œil manquants | Règles « 8 caractères » et « une lettre et un chiffre » cochées en direct, lien « Déjà un compte ? Se connecter », bouton œil |
| Commandes | Seul le statut « Confirmée » | Pastilles Confirmée / En attente / Échouée / Remboursée / Annulée |
| Connexion | N'importe quel mot de passe accepté | Vérification par l'API, message générique en cas d'échec |
| Fiche | Format et pages en dur `[À définir]` / `[N]` | Champs `format` et `pages` de l'e-book ; masqués s'ils sont vides |
| Prix | `[Prix]` partout | Prix formaté `Intl.NumberFormat('fr-FR', {style:'currency'})` depuis l'API |

## 2. Écrans conçus (« À MAQUETTER »)

### Mobile : mot de passe oublié
1. **Demande** : titre « Mot de passe oublié », texte « Saisissez l'e-mail de votre compte, nous vous envoyons un lien valable 30 minutes. », champ e-mail, bouton accent « Envoyer le lien ».
2. **E-mail envoyé** : icône enveloppe sur indigoSoft, titre « Vérifiez votre boîte mail », texte neutre qui ne révèle pas si le compte existe, bouton « Renvoyer » désactivé 60 s (compte à rebours), lien « Revenir à la connexion ».
3. **Nouveau mot de passe** (ouvert par lien profond `folio://reset?token=…`) : 2 champs avec œil, règles en direct, bouton « Enregistrer ». Succès : toast et retour à la connexion. Lien expiré : état d'erreur avec « Demander un nouveau lien ».

### Administration web (largeur ≥ 1024 px, menu latéral encre)
Menu : Tableau de bord · E-books · Commandes · Utilisateurs · Statistiques · Paramètres.

- **E-books (liste)** : recherche, filtre de statut (Tous / Brouillons / Publiés / Archivés), tableau avec couverture 40×60, titre/auteur, catégorie, prix, statut, ventes, date de mise à jour, et bouton « Nouvel e-book ».
- **E-book (édition)** : colonnes Informations (titre, auteur, catégorie, description, prix, devise, format, pages) et Fichiers (couverture 2:3, fichier principal privé, extrait), réglages d'accès (téléchargement autorisé), aperçu de la fiche mobile, barre d'actions (Enregistrer le brouillon · Publier · Dépublier · Archiver · Supprimer). Les actions destructrices demandent une confirmation.
- **Commandes** : recherche (référence, e-mail), puces de statut avec compteurs, tableau (référence, client, articles, montant, statut, date) ; le détail affiche les lignes, l'historique des paiements (identifiant prestataire, sans donnée de carte) et le bouton « Rembourser » avec confirmation ; export CSV.
- **Utilisateurs** : recherche, filtre rôle/statut, détail (commandes, bibliothèque, appareils), actions Suspendre / Réactiver, Exporter les données (RGPD), Anonymiser.
- **Statistiques** : période (7 j / 30 j / 90 j / 12 mois), CA, commandes payées, panier moyen, taux d'échec, ventes par semaine, top e-books, consultations de fiche par e-book.
- **Paramètres** : nom de l'app, mode de paiement par plateforme (`external` / `web_only`), limites (appareils, téléchargements, durée des URL), contact support, URL des CGU/CGV/confidentialité.

## 3. États par écran

| État | Règle |
|---|---|
| Chargement | Squelettes à la forme du contenu (couverture 2:3, 2 lignes de texte) ; jamais d'écran blanc ; spinner seulement dans les boutons |
| Vide | `EmptyState` (icône 96 px, titre serif, texte, action) : catalogue sans résultat, panier vide, bibliothèque vide, aucune commande |
| Erreur réseau | Bandeau « Connexion impossible. Vérifiez votre réseau. » + « Réessayer » ; les données déjà affichées sont conservées |
| Hors ligne | Bandeau discret « Hors ligne » ; la bibliothèque n'affiche que les e-books téléchargés ; achat et connexion désactivés avec explication |
| Succès | Toast `role=status` 2,2 s ; écran dédié pour la confirmation de commande |
| Désactivé | Opacité 0,55, `accessibilityState.disabled`, raison expliquée à côté |

## 4. Ajouts au parcours (implémentés dans l'app mobile)
Écran « Paiement en vérification », `StepBar` du tunnel, onglets et recherche de la bibliothèque, sommaire et réglages du lecteur, rubriques du compte dont la suppression (double confirmation, saisie du mot « SUPPRIMER »).

## 5. Accessibilité (WCAG 2.2 AA)
- **Contrastes** : encre sur papier 17,6:1 ; gris texte 6,4:1 ; blanc sur indigo 7,0:1 ; encre sur lime 14,9:1. **Interdit** : lime sur papier (1,2:1).
- **Cibles** : au moins 44×44 px (critère 2.5.8) ; boutons de 52 px.
- **Lecteurs d'écran** : chaque bouton-icône a un `accessibilityLabel` (« Retour », « Panier, 2 articles », « Télécharger L'Art de ralentir ») ; les couvertures ont `accessibilityRole="image"` et le libellé « Couverture : titre » ; les pastilles de statut sont lues en clair.
- **Ordre de focus** : celui de la lecture visuelle ; le focus va sur le titre de l'écran à son ouverture ; les toasts et les erreurs sont annoncés (`accessibilityLiveRegion`/`role=alert`).
- **Texte agrandi à 200 %** : tailles en `fontSize` système (`allowFontScaling`) ; aucune hauteur fixe sur un conteneur de texte ; boutons en `minHeight`.
- **Mouvement** : animations désactivées si « Réduire les animations » est actif.

## 6. Bibliothèque de composants
Voir la section `components` de `design-tokens.json`. Implémentation : `mobile/src/ui/*` et `admin/src/components/*`.
