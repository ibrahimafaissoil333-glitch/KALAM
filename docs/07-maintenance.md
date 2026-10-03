# Phase 7 — Maintenance et évolutions

## 1. Niveaux de support
Les délais sont **à définir avec le propriétaire**. Les valeurs entre crochets sont des propositions à valider.

| Priorité | Exemples | Prise en charge | Résolution ou contournement |
|---|---|---|---|
| P1 — Critique | Service ou paiement indisponible ; accès à un livre non payé ; fuite de données | [1 h, 7 j/7] | [4 h] |
| P2 — Majeure | Webhook en échec ; lecteur inutilisable sur une version d'OS ; e-mails non envoyés | [4 h ouvrées] | [2 j ouvrés] |
| P3 — Mineure | Défaut d'affichage, texte erroné | [2 j ouvrés] | Version suivante |
| Demande | Question client, export RGPD, remboursement | [2 j ouvrés] | Selon la demande (RGPD : 1 mois au plus) |

**Circuit d'une demande** : réception (e-mail support ou alerte) → qualification (priorité, P1 signalée à l'astreinte) → ticket → diagnostic (journaux, Sentry, Admin → Journal) → correction ou réponse → vérification → clôture avec la solution documentée → revue mensuelle des tickets.

## 2. Maintenance préventive

| Fréquence | Tâche |
|---|---|
| Chaque semaine | `npm audit` sur les 3 projets ; correctifs de sécurité appliqués sous 7 jours |
| Chaque mois | Mise à jour mineure des dépendances ; revue des alertes et des commandes `PENDING` ou `FAILED` |
| Chaque trimestre | Restauration complète de la sauvegarde sur un environnement vierge ; rotation des secrets ; vérification des règles des stores sur le paiement |
| Deux fois par an | Montée de SDK Expo (une version par cycle) ; test sur les nouvelles versions bêta d'iOS et d'Android (été) |
| Chaque année | Renouvellement du compte Apple Developer ; certificats et profils (EAS) ; version de l'API Stripe ; revue RGPD (registre, durées de conservation) |

## 3. Priorisation des évolutions (CDC §19.2)
Notes de 1 à 5. **Score = valeur × 2 − effort − risque**. À recalculer avec les statistiques d'usage réelles après 2 mois.

| Évolution | Valeur | Effort | Risque | Score | Signal à suivre |
|---|---|---|---|---|---|
| Favoris / liste d'envies | 3 | 1 | 1 | 4 | Consultations de fiches sans achat |
| Codes promo | 4 | 2 | 2 | 4 | Taux de conversion fiche → achat |
| Avis et notes (avec modération) | 3 | 3 | 3 | 0 | Volume de lecteurs actifs |
| Annotations et surlignage | 3 | 3 | 1 | 2 | Temps de lecture moyen |
| Notifications push | 3 | 2 | 1 | 3 | Taux d'ouverture des e-mails |
| Filigrane personnalisé des fichiers | 2 | 2 | 1 | 1 | Signalements de partage |
| Abonnement | 4 | 4 | 4 | 0 | Nombre d'achats par client |
| Internationalisation / multidevise | 3 | 3 | 2 | 1 | Part des ventes hors France |

## 4. Feuille de route sur 6 mois (proposition)
- **Mois 1** : stabilisation après le lancement, corrections, suivi des indicateurs.
- **Mois 2** : favoris et notifications push.
- **Mois 3** : codes promo (admin + panier + Stripe).
- **Mois 4** : annotations et surlignage, synchronisés.
- **Mois 5** : filigrane des téléchargements ; tableau de bord par catégorie.
- **Mois 6** : bilan et décision sur l'abonnement et l'internationalisation.

## 5. Indicateurs
Taux de conversion fiche → achat · taux d'échec de paiement · délai moyen entre paiement et webhook · commandes `PENDING` de plus de 15 min · lecteurs actifs (7 j / 30 j) · taux de lecture au-delà de 50 % · crashs pour 1 000 sessions · disponibilité de l'API · p95 de latence · nombre et délai de traitement des tickets.
