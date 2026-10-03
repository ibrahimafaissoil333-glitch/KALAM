# Phase 6 — Mise en production

## 1. Vérifications avant la mise en production

**Configuration de l'API** (voir `api/.env.example`)
- [ ] `NODE_ENV=production` : l'API refuse de démarrer avec le paiement `fake`, avec des e-mails en console ou des secrets trop courts.
- [ ] `JWT_ACCESS_SECRET` et `STORAGE_SIGNING_SECRET` aléatoires (au moins 32 caractères), stockés dans le gestionnaire de secrets de l'hébergeur.
- [ ] `DATABASE_URL` pointe vers une base gérée avec PITR, et `prisma migrate deploy` est exécuté au déploiement.
- [ ] `STORAGE_DRIVER=s3`, bucket **privé** (aucune règle publique), versionnement activé.
- [ ] `PAYMENT_PROVIDER=stripe`, clés **live** ; `STRIPE_WEBHOOK_SECRET` de l'endpoint live ; Stripe Tax activé si décidé (`STRIPE_AUTOMATIC_TAX=true`).
- [ ] Webhook Stripe configuré sur `https://<api>/v1/webhooks/payment` avec les événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`.
- [ ] `CHECKOUT_RETURN_URL=folio://checkout/return` (ou un lien universel).
- [ ] `MAIL_DRIVER=smtp`, SPF/DKIM/DMARC configurés pour le domaine d'envoi.
- [ ] `CORS_ORIGINS` limité à l'URL de l'admin.
- [ ] HTTPS partout (HSTS) ; l'admin sur un sous-domaine dédié.

**Exploitation**
- [ ] Sauvegardes : **une vraie restauration testée** sur une base vierge, avec durée relevée.
- [ ] Supervision : `/v1/health` surveillé chaque minute ; Sentry branché ; alertes sur 5xx > 1 %, webhooks rejetés et commandes `PENDING` de plus de 15 min.
- [ ] Journaux JSON centralisés, conservés selon la politique RGPD.
- [ ] Compte admin réel créé, compte de démonstration supprimé ; ne pas lancer `seed` en production.

## 2. Publication sur les stores
- [ ] **Modèle de paiement validé pays par pays** (docs/01-cadrage.md §2) et `checkoutMode` réglé dans l'admin pour chaque plateforme.
- [ ] Comptes : Apple Developer Program et Google Play Console au nom du propriétaire.
- [ ] Builds avec `npx eas-cli@latest build -p ios|android --profile production` ; envoi avec `eas submit`.
- [ ] Fiches : nom, sous-titre, description, mots-clés, catégorie (Livres), classification d'âge.
- [ ] Captures : iPhone 6,9" et 6,5" ; Android téléphone. À prendre sur l'accueil, la fiche, la bibliothèque et le lecteur.
- [ ] Politique de confidentialité en ligne (URL obligatoire).
- [ ] Déclarations : *App Privacy* (Apple) et *Data safety* (Google). Données collectées : e-mail, nom, historique d'achat, identifiant d'appareil. Pas de suivi publicitaire.
- [ ] **Compte de test pour les vérificateurs**, avec un e-book déjà acheté et des instructions en anglais.
- [ ] Suppression de compte accessible depuis l'app (exigence des deux stores) : faite (Compte → Supprimer mon compte).

## 3. Documents légaux à faire valider par un juriste
- **CGU** : accès au service, compte, comportement, propriété intellectuelle.
- **CGV** : prix TTC, paiement, livraison numérique immédiate, **droit de rétractation pour les contenus numériques** (renonciation expresse au moment de l'achat : case du paiement, texte à valider), remboursements, réclamations, médiation.
- **Politique de confidentialité** : responsable de traitement, finalités, bases légales, durées de conservation, sous-traitants (hébergeur, Stripe, e-mails), droits et exercice, transferts hors UE.
- **Mentions légales** : éditeur, hébergeur, directeur de publication.
Les URL se renseignent dans Admin → Paramètres → Documents légaux.

## 4. Plan de lancement
1. **J-7** : recette acceptée (PV signé), contenus réels chargés et publiés, prix définis.
2. **J-3** : soumission aux stores ; publication en mode manuel après approbation.
3. **J0** : déploiement progressif sur Google Play (10 % → 50 % → 100 % sur 72 h) ; publication manuelle sur l'App Store.
4. **72 premières heures** : revue des alertes 3 fois par jour, des commandes `PENDING` et `FAILED`, du taux d'échec de paiement et des crashs (Sentry) ; une personne d'astreinte nommée.
5. **Retour arrière** :
   - API : redéployer l'image précédente. Les migrations sont additives et ne bloquent pas le retour.
   - Mobile : `eas update --branch production` avec la version précédente pour une correction JS, ou arrêt du déploiement progressif sur Google Play.
   - Paiement : basculer `checkoutMode` en `web_only` depuis l'admin, sans nouvelle version de l'app.

## 5. Guides
- [Guide administrateur](guide-administrateur.md)
- [Guide utilisateur](guide-utilisateur.md)
