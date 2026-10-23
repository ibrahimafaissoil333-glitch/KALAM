-- Retour à la charte d'origine (encre, lime, gris clair) pour les couvertures générées.
alter table public.ebooks alter column cover_bg set default '#14151F';
alter table public.ebooks alter column cover_fg set default '#D7F25C';
alter table public.ebooks alter column cover_tint set default '#ECEBE6';
