-- Compte PayPal comme moyen de réception des gains (fichier séparé : une valeur d'enum doit être validée avant usage).
alter type public.payout_account_kind add value if not exists 'PAYPAL';
