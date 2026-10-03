# Guide administrateur — Folio

## Se connecter
Ouvrez l'adresse de l'administration, puis saisissez l'e-mail et le mot de passe de votre compte administrateur. La session dure 12 h. Chaque connexion est inscrite dans le **Journal**.

## Publier un e-book
1. **E-books → Nouvel e-book** : saisissez le titre et l'auteur, puis **Enregistrer le brouillon**.
2. Complétez la catégorie, la description et le **prix TTC** (exemple : `12,99`). Si le prix reste vide, l'e-book ne peut pas être publié.
3. **Fichiers** :
   - **Couverture** : image JPEG, PNG ou WebP au format portrait 2:3. Sans image, une couverture est générée avec les couleurs choisies.
   - **Fichier de l'e-book** : EPUB recommandé. Le texte est extrait automatiquement pour la lecture dans l'app. Un PDF n'est proposé qu'en téléchargement.
4. **Accès** :
   - « Autoriser le téléchargement » permet au client de récupérer le fichier original.
   - « Taille de l'extrait » fixe le nombre de paragraphes lisibles gratuitement.
   - « Mettre en avant » ajoute l'e-book à la « Sélection du moment ».
5. Vérifiez l'**aperçu de la fiche**, puis **Publier**. Un message liste ce qui manque éventuellement.

**Dépublier** retire l'e-book du catalogue, mais les acheteurs le gardent. **Archiver** le retire aussi de la sélection. **Supprimer** n'est possible que pour un brouillon jamais vendu.

## Commandes
- Les filtres de statut indiquent le nombre de commandes par statut : **Confirmée**, **En attente** (paiement en vérification), **Échouée**, **Remboursée**, **Annulée** (abandonnée).
- Le détail d'une commande montre les articles, le paiement (sans donnée de carte) et les événements reçus du prestataire.
- **Rembourser** : le client est remboursé par le prestataire, perd l'accès aux e-books de la commande et reçoit un e-mail. Cette action est irréversible.
- **Exporter en CSV** : télécharge les commandes filtrées. Le fichier s'ouvre dans Excel ou Numbers.

## Utilisateurs et demandes RGPD
- **Suspendre** déconnecte le client de tous ses appareils et bloque sa connexion. **Réactiver** annule la suspension.
- **Exporter les données** télécharge un fichier JSON à transmettre au client qui en fait la demande.
- **Anonymiser** efface le nom, l'e-mail, les appareils et les accès. Les commandes restent conservées pour la comptabilité.

## Statistiques
Choisissez la période (7 jours, 30 jours, 90 jours ou 12 mois). Le chiffre d'affaires ne compte que les commandes confirmées : les remboursements sont exclus.

## Paramètres
- **Modèle de paiement** par plateforme : paiement externe depuis l'app, ou « app de lecture » avec achat sur le site uniquement. Le changement s'applique immédiatement, sans mise à jour de l'app.
- **Limites** : nombre d'appareils par compte et de téléchargements par e-book. Laissez vide pour ne pas limiter.
- **Support et documents légaux** : ces liens apparaissent dans l'app.

## Journal
Toutes les actions sensibles y sont inscrites avec la date, l'auteur et l'adresse IP : publication, prix, remboursement, suspension, export et paramètres.
