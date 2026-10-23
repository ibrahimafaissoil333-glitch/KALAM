-- Couleurs par défaut des couvertures générées : charte du logo (marine, or, crème doré).
alter table public.ebooks alter column cover_bg set default '#182840';
alter table public.ebooks alter column cover_fg set default '#C19846';
alter table public.ebooks alter column cover_tint set default '#F3E8D0';
