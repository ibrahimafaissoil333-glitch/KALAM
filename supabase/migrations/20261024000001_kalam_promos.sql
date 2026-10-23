-- Nom de l'application : Kalam. Carrousel publicitaire de l'accueil : n'importe quel livre
-- publié peut être mis en avant par l'admin, avec une vidéo facultative par diapositive.

-- ── Nom par défaut ──────────────────────────────────────────────

create or replace function public.app_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'appName', 'Kalam',
    'checkoutMode', jsonb_build_object('ios', 'external', 'android', 'external'),
    'webCheckoutUrl', null, 'maxDevices', null, 'maxDownloadsPerBook', null, 'supportEmail', null,
    'termsUrl', null, 'salesTermsUrl', null, 'privacyUrl', null, 'legalNoticeUrl', null,
    'commissionPercent', 2
  ) || coalesce((select value from public.settings where key = 'app'), '{}'::jsonb)
$$;
-- Un ancien nom « Folio » enregistré dans les paramètres est remplacé.
update public.settings set value = value || '{"appName": "Kalam"}'::jsonb where key = 'app' and value->>'appName' = 'Folio';

-- ── Diapositives ────────────────────────────────────────────────

create table public.promo_slides (
  id uuid primary key default gen_random_uuid(),
  ebook_id uuid not null references public.ebooks (id) on delete cascade,
  headline text check (headline is null or length(headline) <= 80),
  subtitle text check (subtitle is null or length(subtitle) <= 140),
  video_path text,
  sort int not null default 0,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index on public.promo_slides (active, sort);
alter table public.promo_slides enable row level security;
-- Aucune lecture directe : diapositives servies par catalog_home / admin_promo_slides.

-- Vidéos des diapositives : bucket public (lecture en streaming par l'app), écriture par la fonction Edge admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('promos', 'promos', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

create or replace function public.promo_slide_json(s public.promo_slides) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'headline', s.headline, 'subtitle', s.subtitle, 'videoPath', s.video_path,
    'sort', s.sort, 'active', s.active, 'startsAt', s.starts_at, 'endsAt', s.ends_at,
    'ebook', (select public.ebook_json(e, e.id = any(public.owned_ids(auth.uid()))) || jsonb_build_object('status', e.status)
              from public.ebooks e where e.id = s.ebook_id))
$$;

-- Accueil : diapositives actives (livres publiés, dans leur période) ; l'app retombe sur la sélection si la liste est vide.
create or replace function public.catalog_home() returns jsonb
language sql stable security definer set search_path = '' as $$
  with o as (select public.owned_ids(auth.uid()) ids)
  select jsonb_build_object(
    'slides', coalesce((select jsonb_agg(public.promo_slide_json(s) order by s.sort, s.created_at) from public.promo_slides s
      join public.ebooks e on e.id = s.ebook_id
      where s.active and e.status = 'PUBLISHED' and e.price_cents is not null
        and (s.starts_at is null or s.starts_at <= now()) and (s.ends_at is null or s.ends_at > now())), '[]'),
    'featured', coalesce((select jsonb_agg(public.ebook_json(e, e.id = any(o.ids)) order by e.published_at desc) from (
      select * from public.ebooks where status = 'PUBLISHED' and price_cents is not null and featured order by published_at desc limit 8) e, o), '[]'),
    'latest', coalesce((select jsonb_agg(public.ebook_json(e, e.id = any(o.ids)) order by e.published_at desc) from (
      select * from public.ebooks where status = 'PUBLISHED' and price_cents is not null order by published_at desc limit 3) e, o), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'slug', slug) order by sort) from public.categories), '[]'))
$$;

-- ── Administration ──────────────────────────────────────────────

create or replace function public.admin_promo_slides() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(public.promo_slide_json(s) order by s.sort, s.created_at) from public.promo_slides s), '[]');
end $$;

create or replace function public.admin_save_promo_slide(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.promo_slides; book uuid := nullif(p->>'ebookId', '')::uuid;
begin
  perform public.require_admin();
  if p_id is null then
    if book is null or not exists (select 1 from public.ebooks where id = book) then raise exception 'Choisissez un livre.' using errcode = 'PT400'; end if;
    insert into public.promo_slides (ebook_id, sort) values (book, coalesce((select max(sort) + 1 from public.promo_slides), 0)) returning * into s;
  else
    select * into s from public.promo_slides where id = p_id;
    if s.id is null then raise exception 'Diapositive introuvable.' using errcode = 'PT404'; end if;
    if book is not null and not exists (select 1 from public.ebooks where id = book) then raise exception 'Livre introuvable.' using errcode = 'PT400'; end if;
  end if;
  if length(p->>'headline') > 80 then raise exception 'Titre trop long (80 caractères maximum).' using errcode = 'PT400'; end if;
  if length(p->>'subtitle') > 140 then raise exception 'Sous-titre trop long (140 caractères maximum).' using errcode = 'PT400'; end if;
  if (p->>'startsAt') is not null and (p->>'endsAt') is not null and (p->>'endsAt')::timestamptz <= (p->>'startsAt')::timestamptz then
    raise exception 'La fin doit être après le début.' using errcode = 'PT400';
  end if;
  update public.promo_slides set
    ebook_id = coalesce(book, ebook_id),
    headline = case when p ? 'headline' then nullif(trim(p->>'headline'), '') else headline end,
    subtitle = case when p ? 'subtitle' then nullif(trim(p->>'subtitle'), '') else subtitle end,
    sort = coalesce((p->>'sort')::int, sort),
    active = coalesce((p->>'active')::boolean, active),
    starts_at = case when p ? 'startsAt' then (p->>'startsAt')::timestamptz else starts_at end,
    ends_at = case when p ? 'endsAt' then (p->>'endsAt')::timestamptz else ends_at end,
    updated_at = now()
  where id = s.id returning * into s;
  perform public.audit('promo.save', 'promo_slide', s.id::text, jsonb_build_object('ebook', s.ebook_id, 'active', s.active));
  return public.promo_slide_json(s);
end $$;

-- Échange l'ordre de deux diapositives voisines.
create or replace function public.admin_move_promo_slide(p_id uuid, p_dir int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.promo_slides; other public.promo_slides;
begin
  perform public.require_admin();
  select * into s from public.promo_slides where id = p_id;
  if s.id is null then raise exception 'Diapositive introuvable.' using errcode = 'PT404'; end if;
  select * into other from public.promo_slides
  where case when p_dir < 0 then (sort, created_at) < (s.sort, s.created_at) else (sort, created_at) > (s.sort, s.created_at) end
  order by case when p_dir < 0 then sort end desc, case when p_dir < 0 then created_at end desc,
           case when p_dir >= 0 then sort end, case when p_dir >= 0 then created_at end
  limit 1;
  if other.id is not null then
    update public.promo_slides set sort = other.sort, updated_at = now() where id = s.id;
    update public.promo_slides set sort = s.sort, updated_at = now() where id = other.id;
    if s.sort = other.sort then update public.promo_slides set sort = sort + p_dir where id = s.id; end if;
  end if;
  return public.admin_promo_slides();
end $$;

-- Suppression ; renvoie le chemin de la vidéo à effacer du stockage.
create or replace function public.admin_delete_promo_slide(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare path text;
begin
  perform public.require_admin();
  delete from public.promo_slides where id = p_id returning video_path into path;
  perform public.audit('promo.delete', 'promo_slide', p_id::text, null);
  return path;
end $$;

revoke execute on function public.promo_slide_json(public.promo_slides), public.admin_promo_slides(), public.admin_save_promo_slide(uuid, jsonb),
  public.admin_move_promo_slide(uuid, int), public.admin_delete_promo_slide(uuid) from public, anon, authenticated;
grant execute on function public.admin_promo_slides(), public.admin_save_promo_slide(uuid, jsonb), public.admin_move_promo_slide(uuid, int),
  public.admin_delete_promo_slide(uuid) to authenticated;
grant execute on all functions in schema public to service_role;
