-- Folio — fonctions, déclencheurs, règles d'accès (RLS)

-- ── Aides ───────────────────────────────────────────────────────

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN' and p.status = 'ACTIVE')
$$;

-- Identifiant du compte connecté et actif ; sinon erreur (un compte suspendu perd l'accès immédiatement).
create or replace function public.current_active_uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = uid and status = 'ACTIVE') then
    raise exception 'Compte inactif.' using errcode = '28000';
  end if;
  return uid;
end $$;

create or replace function public.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé.' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create or replace function public.slugify(t text) returns text
language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(regexp_replace(public.norm(t), '[''’]', '', 'g'), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function public.money(cents int, cur text) returns text
language sql immutable set search_path = '' as $$
  select replace(to_char(cents / 100.0, 'FM999999990.00'), '.', ',') || ' ' || case cur when 'EUR' then '€' else cur end
$$;

create or replace function public.queue_email(p_to text, p_kind text, p_subject text, p_body text) returns void
language sql security definer set search_path = '' as $$
  insert into public.email_outbox (to_email, kind, subject, body) select p_to, p_kind, p_subject, p_body where p_to is not null
$$;

create or replace function public.audit(p_action text, p_type text, p_id text, p_meta jsonb default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values ((select id from public.profiles where id = auth.uid()), p_action, p_type, p_id, p_meta)
$$;

-- ── Paramètres (« à définir » du CDC) ───────────────────────────

create or replace function public.app_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'appName', 'Folio',
    'checkoutMode', jsonb_build_object('ios', 'external', 'android', 'external'),
    'webCheckoutUrl', null, 'maxDevices', null, 'maxDownloadsPerBook', null, 'supportEmail', null,
    'termsUrl', null, 'salesTermsUrl', null, 'privacyUrl', null, 'legalNoticeUrl', null
  ) || coalesce((select value from public.settings where key = 'app'), '{}'::jsonb)
$$;

create or replace function public.public_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'appName', s->'appName', 'checkoutMode', s->'checkoutMode', 'webCheckoutUrl', s->'webCheckoutUrl', 'supportEmail', s->'supportEmail',
    'legal', jsonb_build_object('terms', s->'termsUrl', 'salesTerms', s->'salesTermsUrl', 'privacy', s->'privacyUrl', 'legalNotice', s->'legalNoticeUrl'))
  from (select public.app_settings() s) x
$$;

-- ── Comptes ─────────────────────────────────────────────────────

-- Création du profil à l'inscription. L'acceptation des CGU est obligatoire (CDC §5.4).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  consent boolean := coalesce((meta->>'marketing_consent')::boolean, false);
  nm text := trim(coalesce(meta->>'name', ''));
begin
  if coalesce((meta->>'accept_terms')::boolean, false) is not true and coalesce((meta->>'seed')::boolean, false) is not true then
    raise exception 'Acceptez les conditions pour créer votre compte.';
  end if;
  if nm = '' then nm := split_part(new.email, '@', 1); end if;
  insert into public.profiles (id, email, name, marketing_consent, marketing_consent_at, terms_accepted_at)
  values (new.id, lower(new.email), left(nm, 80), consent, case when consent then now() end, now());
  insert into public.notification_prefs (user_id, marketing) values (new.id, consent);
  perform public.queue_email(lower(new.email), 'account_created', 'Bienvenue sur Folio',
    format(E'Bonjour %s,\n\nVotre compte Folio est créé. Vos achats seront disponibles dans votre bibliothèque, sur tous vos appareils.\n\nÀ bientôt,\nL''équipe Folio', nm));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email), updated_at = now() where id = new.id and status <> 'DELETED';
  return new;
end $$;
create trigger on_auth_user_email after update of email on auth.users for each row execute function public.sync_user_email();

create or replace function public.update_my_profile(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indiquez un prénom ou un pseudonyme.'; end if;
  update public.profiles set name = left(trim(p_name), 80), updated_at = now() where id = uid;
  return (select jsonb_build_object('id', id, 'name', name, 'email', email, 'role', role) from public.profiles where id = uid);
end $$;

create or replace function public.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'name', name, 'email', email, 'role', role, 'status', status, 'createdAt', created_at)
  from public.profiles where id = auth.uid()
$$;

create or replace function public.set_notification_prefs(p_ebook_updates boolean, p_marketing boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  insert into public.notification_prefs (user_id, ebook_updates, marketing) values (uid, p_ebook_updates, p_marketing)
  on conflict (user_id) do update set ebook_updates = excluded.ebook_updates, marketing = excluded.marketing;
  -- Consentement marketing horodaté (RGPD).
  update public.profiles set marketing_consent = p_marketing, marketing_consent_at = now() where id = uid;
  return jsonb_build_object('orders', true, 'ebookUpdates', p_ebook_updates, 'marketing', p_marketing);
end $$;

-- Appareils : limite configurable (décision D9).
create or replace function public.register_device(p_key text, p_label text, p_platform text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); did uuid; lim int := (public.app_settings()->>'maxDevices')::int;
begin
  select id into did from public.devices where user_id = uid and device_key = p_key;
  if did is not null then
    update public.devices set last_seen_at = now(), label = left(coalesce(p_label, label), 100) where id = did;
    return did;
  end if;
  if lim is not null and (select count(*) from public.devices where user_id = uid) >= lim then
    raise exception 'Nombre maximal d''appareils atteint (%). Retirez un appareil depuis votre compte.', lim using errcode = 'P0409';
  end if;
  insert into public.devices (user_id, device_key, label, platform) values (uid, left(p_key, 100), left(coalesce(p_label, 'Appareil'), 100), left(coalesce(p_platform, 'inconnu'), 20))
  returning id into did;
  return did;
end $$;

create or replace function public.remove_device(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.devices where id = p_id and user_id = public.current_active_uid()
$$;

create or replace function public.my_export() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  perform public.audit('user.export', 'user', uid::text);
  return jsonb_build_object(
    'exportedAt', now(),
    'profile', (select to_jsonb(p) - 'role' from public.profiles p where id = uid),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('reference', o.reference, 'status', o.status, 'totalCents', o.total_cents, 'currency', o.currency, 'createdAt', o.created_at,
        'items', (select jsonb_agg(jsonb_build_object('title', i.title, 'priceCents', i.price_cents)) from public.order_items i where i.order_id = o.id)))
      from public.orders o where o.user_id = uid), '[]'),
    'library', coalesce((select jsonb_agg(jsonb_build_object('title', e.title, 'grantedAt', en.granted_at, 'revokedAt', en.revoked_at))
      from public.entitlements en join public.ebooks e on e.id = en.ebook_id where en.user_id = uid), '[]'),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'platform', platform, 'createdAt', created_at)) from public.devices where user_id = uid), '[]'),
    'notifications', (select to_jsonb(n) - 'user_id' from public.notification_prefs n where user_id = uid));
end $$;

-- Effacement RGPD : anonymise le profil, conserve les commandes (obligation comptable).
create or replace function public.anonymize_user(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.devices where user_id = p_id;
  delete from public.reading_progress where user_id = p_id;
  delete from public.notification_prefs where user_id = p_id;
  delete from public.cart_items where user_id = p_id;
  update public.entitlements set revoked_at = now() where user_id = p_id and revoked_at is null;
  update public.profiles set email = null, name = 'Compte supprimé', status = 'DELETED', deleted_at = now(), marketing_consent = false where id = p_id;
end $$;

-- ── Catalogue ───────────────────────────────────────────────────

create or replace function public.ebooks_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.slug is null or new.slug = '' then new.slug := public.slugify(new.title) || '-' || substr(new.id::text, 1, 6); end if;
  new.search_text := public.norm(concat_ws(' ', new.title, new.author, (select name from public.categories where id = new.category_id), new.description));
  new.updated_at := now();
  return new;
end $$;
create trigger ebooks_before_write before insert or update on public.ebooks for each row execute function public.ebooks_before_write();

create or replace function public.owned_ids(uid uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(ebook_id), '{}') from public.entitlements where user_id = uid and revoked_at is null
$$;

create or replace function public.ebook_json(e public.ebooks, owned boolean default false) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'title', e.title, 'author', e.author, 'description', e.description,
    'category', (select jsonb_build_object('name', c.name, 'slug', c.slug) from public.categories c where c.id = e.category_id),
    'priceCents', e.price_cents, 'currency', e.currency, 'format', e.format, 'pages', e.pages,
    'downloadAllowed', e.download_allowed, 'publishedAt', e.published_at,
    'cover', jsonb_build_object('bg', e.cover_bg, 'fg', e.cover_fg, 'tint', e.cover_tint,
      'path', (select f.storage_path from public.ebook_files f where f.ebook_id = e.id and f.kind = 'COVER' order by f.created_at desc limit 1)),
    'owned', owned)
$$;

create or replace function public.search_ebooks(p_q text default null, p_category text default null, p_sort text default 'new', p_page int default 1, p_page_size int default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owned uuid[] := public.owned_ids(auth.uid());
  words text[] := case when coalesce(trim(p_q), '') = '' then '{}' else regexp_split_to_array(public.norm(trim(p_q)), '\s+') end;
  sz int := least(greatest(coalesce(p_page_size, 20), 1), 50);
  pg int := greatest(coalesce(p_page, 1), 1);
  result jsonb;
begin
  with f as (
    select e.* from public.ebooks e
    left join public.categories c on c.id = e.category_id
    where e.status = 'PUBLISHED' and e.price_cents is not null
      and (p_category is null or p_category = '' or c.slug = p_category)
      and (select bool_and(e.search_text like '%' || w || '%') from unnest(words) w) is not false
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'page', pg, 'pageSize', sz,
    'items', coalesce((select jsonb_agg(public.ebook_json(x.e, (x.e).id = any(owned)) order by rn) from (
      select f::public.ebooks as e, row_number() over (order by
        case when p_sort = 'title' then public.norm(f.title) end,
        case when p_sort = 'author' then public.norm(f.author) end,
        case when p_sort = 'author' then public.norm(f.title) end,
        f.published_at desc, f.title) rn
      from f order by rn offset (pg - 1) * sz limit sz) x), '[]'))
  into result;
  return result;
end $$;

create or replace function public.catalog_home() returns jsonb
language sql stable security definer set search_path = '' as $$
  with o as (select public.owned_ids(auth.uid()) ids)
  select jsonb_build_object(
    'featured', coalesce((select jsonb_agg(public.ebook_json(e, e.id = any(o.ids)) order by e.published_at desc) from (
      select * from public.ebooks where status = 'PUBLISHED' and price_cents is not null and featured order by published_at desc limit 8) e, o), '[]'),
    'latest', coalesce((select jsonb_agg(public.ebook_json(e, e.id = any(o.ids)) order by e.published_at desc) from (
      select * from public.ebooks where status = 'PUBLISHED' and price_cents is not null order by published_at desc limit 3) e, o), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'slug', slug) order by sort) from public.categories), '[]'))
$$;

-- Fiche : publiée, ou possédée même dépubliée (règle D12). Compte une consultation.
create or replace function public.ebook_detail(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; is_owned boolean;
begin
  select * into e from public.ebooks where slug = p_slug;
  is_owned := e.id is not null and e.id = any(public.owned_ids(auth.uid()));
  if e.id is null or (e.status <> 'PUBLISHED' and not is_owned) then
    raise exception 'E-book introuvable.' using errcode = 'P0404';
  end if;
  insert into public.ebook_views (ebook_id) values (e.id);
  return public.ebook_json(e, is_owned);
end $$;

-- ── Panier ──────────────────────────────────────────────────────

create or replace function public.cart_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); owned uuid[] := public.owned_ids(uid); removed jsonb;
begin
  -- Un e-book dépublié, sans prix ou déjà acquis ne peut pas être acheté : il quitte le panier.
  with del as (
    delete from public.cart_items ci using public.ebooks e
    where ci.user_id = uid and e.id = ci.ebook_id and (e.status <> 'PUBLISHED' or e.price_cents is null or e.id = any(owned))
    returning e.title)
  select coalesce(jsonb_agg(title), '[]') into removed from del;
  return (
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(public.ebook_json(e) order by ci.added_at), '[]'),
      'count', count(e.id),
      'subtotalCents', coalesce(sum(e.price_cents), 0),
      'totalCents', coalesce(sum(e.price_cents), 0),
      'taxIncluded', true,
      'currency', coalesce(min(e.currency), 'EUR'),
      'removed', removed)
    from public.cart_items ci join public.ebooks e on e.id = ci.ebook_id where ci.user_id = uid);
end $$;

create or replace function public.cart_add(p_ebook uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  if not exists (select 1 from public.ebooks where id = p_ebook and status = 'PUBLISHED' and price_cents is not null) then
    raise exception 'E-book indisponible.' using errcode = 'P0404';
  end if;
  if p_ebook = any(public.owned_ids(uid)) then
    raise exception 'Cet e-book est déjà dans votre bibliothèque.' using errcode = 'P0409';
  end if;
  insert into public.cart_items (user_id, ebook_id) values (uid, p_ebook) on conflict do nothing;
  return public.cart_get();
end $$;

create or replace function public.cart_remove(p_ebook uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.cart_items where user_id = public.current_active_uid() and ebook_id = p_ebook;
  return public.cart_get();
end $$;

-- Fusion du panier invité à la connexion, sans doublon (CA-13).
create or replace function public.cart_merge(p_ebooks uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  insert into public.cart_items (user_id, ebook_id)
  select uid, e.id from public.ebooks e
  where e.id = any(coalesce(p_ebooks, '{}')) and e.status = 'PUBLISHED' and e.price_cents is not null and not (e.id = any(public.owned_ids(uid)))
  on conflict do nothing;
  return public.cart_get();
end $$;

-- ── Bibliothèque ────────────────────────────────────────────────

create or replace function public.my_library() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.ebook_json(e, true) || jsonb_build_object(
      'grantedAt', en.granted_at,
      'readable', exists (select 1 from public.ebook_files f where f.ebook_id = e.id and f.kind = 'CONTENT'),
      'contentVersion', (select f.id from public.ebook_files f where f.ebook_id = e.id and f.kind = 'CONTENT' order by f.created_at desc limit 1),
      'progress', (select jsonb_build_object('chapterIndex', p.chapter_index, 'blockIndex', p.block_index, 'percent', p.percent, 'updatedAt', p.updated_at)
                   from public.reading_progress p where p.user_id = en.user_id and p.ebook_id = e.id))
    order by en.granted_at desc), '[]')
  from public.entitlements en join public.ebooks e on e.id = en.ebook_id
  where en.user_id = public.current_active_uid() and en.revoked_at is null
$$;

create or replace function public.save_progress(p_ebook uuid, p_chapter int, p_block int, p_percent int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  if not (p_ebook = any(public.owned_ids(uid))) then
    raise exception 'Vous n''avez pas accès à cet e-book.' using errcode = '42501';
  end if;
  insert into public.reading_progress (user_id, ebook_id, chapter_index, block_index, percent, updated_at)
  values (uid, p_ebook, greatest(p_chapter, 0), greatest(p_block, 0), least(greatest(p_percent, 0), 100), now())
  on conflict (user_id, ebook_id) do update set chapter_index = excluded.chapter_index, block_index = excluded.block_index,
    percent = excluded.percent, updated_at = excluded.updated_at;
  return jsonb_build_object('chapterIndex', p_chapter, 'blockIndex', p_block, 'percent', p_percent, 'updatedAt', now());
end $$;

-- ── Commandes : opérations réservées aux Edge Functions (service_role) ──

create or replace function public.svc_create_order(p_user uuid, p_ebooks uuid[], p_idem text, p_platform text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  existing public.orders; ids uuid[]; n int; owned_title text; curs int; total int; oid uuid;
begin
  if p_idem is not null then
    select * into existing from public.orders where user_id = p_user and idempotency_key = p_idem;
    if existing.id is not null then return jsonb_build_object('orderId', existing.id, 'existing', true); end if;
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'ACTIVE') then
    raise exception 'Compte inactif.' using errcode = '28000';
  end if;
  ids := case when coalesce(array_length(p_ebooks, 1), 0) > 0 then p_ebooks
              else (select array_agg(ebook_id) from public.cart_items where user_id = p_user) end;
  select array_agg(distinct x) into ids from unnest(ids) x;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Votre panier est vide.' using errcode = 'P0400'; end if;
  select count(*), count(distinct currency), sum(price_cents) into n, curs, total
  from public.ebooks where id = any(ids) and status = 'PUBLISHED' and price_cents is not null;
  if n <> array_length(ids, 1) then raise exception 'Un e-book de votre panier n''est plus disponible.' using errcode = 'P0409'; end if;
  if curs > 1 then raise exception 'Les e-books du panier doivent avoir la même devise.' using errcode = 'P0400'; end if;
  select e.title into owned_title from public.entitlements en join public.ebooks e on e.id = en.ebook_id
  where en.user_id = p_user and en.ebook_id = any(ids) and en.revoked_at is null limit 1;
  if owned_title is not null then raise exception '« % » est déjà dans votre bibliothèque.', owned_title using errcode = 'P0409'; end if;
  begin
    insert into public.orders (reference, user_id, total_cents, currency, idempotency_key, platform)
    values ('FO-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)), p_user, total,
            (select min(currency) from public.ebooks where id = any(ids)), p_idem, p_platform)
    returning id into oid;
  exception when unique_violation then
    -- Deux requêtes simultanées avec la même clé : la commande gagnante est renvoyée.
    select id into oid from public.orders where user_id = p_user and idempotency_key = p_idem;
    return jsonb_build_object('orderId', oid, 'existing', true);
  end;
  insert into public.order_items (order_id, ebook_id, title, price_cents)
  select oid, id, title, price_cents from public.ebooks where id = any(ids);
  return jsonb_build_object('orderId', oid, 'existing', false);
end $$;

-- Enregistre un événement de webhook. Renvoie false si déjà reçu (idempotence, CA-17).
create or replace function public.svc_record_event(p_provider text, p_event text, p_type text, p_outcome text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.payment_events (provider, provider_event_id, type, outcome) values (p_provider, p_event, p_type, p_outcome);
  return true;
exception when unique_violation then
  return false;
end $$;

-- Paiement confirmé : SEUL endroit où un droit d'accès est créé.
create or replace function public.svc_mark_paid(p_provider text, p_event text, p_session text, p_payment_ref text, p_tax int, p_country text) returns text
language plpgsql security definer set search_path = '' as $$
declare pay public.payments; o public.orders; n int; mail text;
begin
  select * into pay from public.payments where provider_session_id = p_session;
  if pay.id is null then return 'ignored'; end if;
  update public.payment_events set order_id = pay.order_id where provider = p_provider and provider_event_id = p_event;
  -- Un paiement confirmé après une annulation automatique reste valable : l'argent a été encaissé.
  update public.orders set status = 'PAID', paid_at = now(), tax_cents = p_tax, tax_country = p_country, updated_at = now()
  where id = pay.order_id and status in ('PENDING', 'CANCELED', 'FAILED') returning * into o;
  if o.id is null then return 'ignored'; end if;
  update public.payments set status = 'SUCCEEDED', provider_payment_id = coalesce(p_payment_ref, provider_payment_id), updated_at = now() where id = pay.id;
  insert into public.entitlements (user_id, ebook_id, order_id)
  select o.user_id, i.ebook_id, o.id from public.order_items i where i.order_id = o.id
  on conflict (user_id, ebook_id) do update set revoked_at = null, order_id = excluded.order_id, granted_at = now();
  delete from public.cart_items ci using public.order_items i where i.order_id = o.id and ci.user_id = o.user_id and ci.ebook_id = i.ebook_id;
  select email into mail from public.profiles where id = o.user_id;
  perform public.queue_email(mail, 'order_confirmed', format('Commande %s confirmée', o.reference),
    format(E'Merci pour votre achat !\n\nCommande %s — %s\n%s\n\nVos e-books sont disponibles dans votre bibliothèque.',
      o.reference, public.money(o.total_cents, o.currency), (select string_agg('• ' || title, E'\n') from public.order_items where order_id = o.id)));
  return 'applied';
end $$;

create or replace function public.svc_mark_failed(p_provider text, p_event text, p_session text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare pay public.payments; o public.orders; mail text;
begin
  select * into pay from public.payments where provider_session_id = p_session;
  if pay.id is null then return 'ignored'; end if;
  update public.payment_events set order_id = pay.order_id where provider = p_provider and provider_event_id = p_event;
  update public.orders set status = 'FAILED', failed_at = now(), updated_at = now() where id = pay.order_id and status = 'PENDING' returning * into o;
  if o.id is null then return 'ignored'; end if;
  update public.payments set status = 'FAILED', failure_reason = p_reason, updated_at = now() where id = pay.id;
  select email into mail from public.profiles where id = o.user_id;
  perform public.queue_email(mail, 'payment_failed', format('Paiement non abouti — commande %s', o.reference),
    format(E'Bonjour,\n\nLe paiement de la commande %s n''a pas abouti. Aucun montant n''a été débité et votre panier est conservé. Vous pouvez réessayer depuis l''application.', o.reference));
  return 'applied';
end $$;

-- Remboursement : l'accès est retiré (règle D11).
create or replace function public.svc_mark_refunded(p_order uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.orders; mail text;
begin
  update public.orders set status = 'REFUNDED', refunded_at = now(), updated_at = now() where id = p_order and status = 'PAID' returning * into o;
  if o.id is null then return 'ignored'; end if;
  update public.payments set status = 'REFUNDED', updated_at = now() where order_id = o.id and status = 'SUCCEEDED';
  update public.entitlements set revoked_at = now() where order_id = o.id and revoked_at is null;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (p_actor, 'order.refund', 'order', o.id::text, jsonb_build_object('reference', o.reference));
  select email into mail from public.profiles where id = o.user_id;
  perform public.queue_email(mail, 'order_refunded', format('Commande %s remboursée', o.reference),
    format(E'Bonjour,\n\nLa commande %s a été remboursée. Les e-books concernés ne sont plus accessibles dans votre bibliothèque.', o.reference));
  return 'applied';
end $$;

create or replace function public.svc_mark_refunded_by_payment(p_provider text, p_event text, p_payment_ref text) returns text
language plpgsql security definer set search_path = '' as $$
declare oid uuid;
begin
  select order_id into oid from public.payments where provider_payment_id = p_payment_ref;
  if oid is null then return 'ignored'; end if;
  update public.payment_events set order_id = oid where provider = p_provider and provider_event_id = p_event;
  return public.svc_mark_refunded(oid, null);
end $$;

-- Commandes abandonnées : PENDING sans webhook au-delà de 60 min → CANCELED (pg_cron).
create or replace function public.cancel_stale_orders(p_minutes int default 60) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.orders set status = 'CANCELED', canceled_at = now(), updated_at = now()
  where status = 'PENDING' and created_at < now() - make_interval(mins => p_minutes);
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Administration ──────────────────────────────────────────────

create or replace function public.admin_ebook_json(e public.ebooks) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.ebook_json(e) || jsonb_build_object(
    'status', e.status, 'featured', e.featured, 'previewBlocks', e.preview_blocks, 'createdAt', e.created_at, 'updatedAt', e.updated_at,
    'sales', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where i.ebook_id = e.id and o.status = 'PAID'),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'mimeType', f.mime_type, 'sizeBytes', f.size_bytes, 'originalName', f.original_name, 'createdAt', f.created_at) order by f.created_at)
                       from public.ebook_files f where f.ebook_id = e.id), '[]'),
    'publishable', to_jsonb(array_remove(array[
      case when e.price_cents is null then 'Prix à définir' end,
      case when trim(e.description) = '' then 'Description manquante' end,
      case when e.category_id is null then 'Catégorie manquante' end,
      case when not exists (select 1 from public.ebook_files f where f.ebook_id = e.id and f.kind = 'MAIN') then 'Fichier principal manquant' end,
      case when not exists (select 1 from public.ebook_files f where f.ebook_id = e.id and f.kind = 'CONTENT') then 'Contenu lisible non extrait (EPUB requis pour la lecture dans l’app)' end
    ], null)))
$$;

create or replace function public.admin_ebooks(p_q text default null, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare words text[] := case when coalesce(trim(p_q), '') = '' then '{}' else regexp_split_to_array(public.norm(trim(p_q)), '\s+') end;
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(public.admin_ebook_json(e) order by e.updated_at desc) from public.ebooks e
    where (p_status is null or p_status = '' or e.status::text = p_status)
      and (select bool_and(e.search_text like '%' || w || '%') from unnest(words) w) is not false), '[]');
end $$;

create or replace function public.admin_ebook(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.ebooks;
begin
  perform public.require_admin();
  select * into e from public.ebooks where id = p_id;
  if e.id is null then raise exception 'E-book introuvable.' using errcode = 'P0404'; end if;
  return public.admin_ebook_json(e);
end $$;

-- Création / modification. `p` reprend les champs du formulaire ; `category` est un nom (créé si absent).
create or replace function public.admin_save_ebook(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; cat uuid; old_price int;
begin
  perform public.require_admin();
  if p ? 'category' then
    if coalesce(trim(p->>'category'), '') = '' then cat := null;
    else
      insert into public.categories (name, slug, sort) values (trim(p->>'category'), public.slugify(p->>'category'), (select count(*) from public.categories))
      on conflict (name) do update set name = excluded.name returning id into cat;
    end if;
  end if;
  if p_id is null then
    if coalesce(trim(p->>'title'), '') = '' or coalesce(trim(p->>'author'), '') = '' then raise exception 'Le titre et l''auteur sont obligatoires.'; end if;
    insert into public.ebooks (slug, title, author) values ('', trim(p->>'title'), trim(p->>'author')) returning * into e;
    e.slug := public.slugify(e.title);
    if exists (select 1 from public.ebooks where slug = e.slug and id <> e.id) then e.slug := e.slug || '-' || substr(e.id::text, 1, 6); end if;
    update public.ebooks set slug = e.slug where id = e.id;
    perform public.audit('ebook.create', 'ebook', e.id::text, jsonb_build_object('title', e.title));
  else
    select * into e from public.ebooks where id = p_id;
    if e.id is null then raise exception 'E-book introuvable.' using errcode = 'P0404'; end if;
  end if;
  old_price := e.price_cents;
  update public.ebooks set
    title = coalesce(nullif(trim(p->>'title'), ''), title),
    author = coalesce(nullif(trim(p->>'author'), ''), author),
    description = coalesce(p->>'description', description),
    category_id = case when p ? 'category' then cat else category_id end,
    price_cents = case when p ? 'priceCents' then (p->>'priceCents')::int else price_cents end,
    currency = coalesce(upper(p->>'currency'), currency),
    format = case when p ? 'format' then nullif(trim(p->>'format'), '') else format end,
    pages = case when p ? 'pages' then (p->>'pages')::int else pages end,
    download_allowed = coalesce((p->>'downloadAllowed')::boolean, download_allowed),
    preview_blocks = coalesce((p->>'previewBlocks')::int, preview_blocks),
    featured = coalesce((p->>'featured')::boolean, featured),
    cover_bg = coalesce(p->>'coverBg', cover_bg), cover_fg = coalesce(p->>'coverFg', cover_fg), cover_tint = coalesce(p->>'coverTint', cover_tint)
  where id = e.id returning * into e;
  if p_id is not null and e.price_cents is distinct from old_price then
    perform public.audit('ebook.price', 'ebook', e.id::text, jsonb_build_object('from', old_price, 'to', e.price_cents));
  end if;
  return public.admin_ebook_json(e);
end $$;

create or replace function public.admin_set_ebook_status(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; problems jsonb;
begin
  perform public.require_admin();
  select * into e from public.ebooks where id = p_id;
  if e.id is null then raise exception 'E-book introuvable.' using errcode = 'P0404'; end if;
  if p_action = 'publish' then
    problems := public.admin_ebook_json(e)->'publishable';
    if jsonb_array_length(problems) > 0 then
      raise exception 'Publication impossible : %.', (select string_agg(x, ', ') from jsonb_array_elements_text(problems) x);
    end if;
    update public.ebooks set status = 'PUBLISHED', published_at = coalesce(published_at, now()) where id = p_id returning * into e;
  elsif p_action = 'unpublish' then
    update public.ebooks set status = 'DRAFT' where id = p_id returning * into e;
  elsif p_action = 'archive' then
    update public.ebooks set status = 'ARCHIVED', featured = false where id = p_id returning * into e;
  else
    raise exception 'Action inconnue.';
  end if;
  perform public.audit('ebook.' || p_action, 'ebook', p_id::text, jsonb_build_object('title', e.title));
  return public.admin_ebook_json(e);
end $$;

-- Suppression définitive : brouillon jamais commandé. Renvoie les chemins de fichiers à effacer du stockage.
create or replace function public.admin_delete_ebook(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; paths jsonb;
begin
  perform public.require_admin();
  select * into e from public.ebooks where id = p_id;
  if e.id is null then raise exception 'E-book introuvable.' using errcode = 'P0404'; end if;
  if e.status <> 'DRAFT' or exists (select 1 from public.order_items where ebook_id = p_id) or exists (select 1 from public.entitlements where ebook_id = p_id) then
    raise exception 'Seul un brouillon jamais commandé peut être supprimé. Archivez-le plutôt.' using errcode = 'P0409';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('path', storage_path, 'kind', kind)), '[]') into paths from public.ebook_files where ebook_id = p_id;
  delete from public.ebooks where id = p_id;
  perform public.audit('ebook.delete', 'ebook', p_id::text, jsonb_build_object('title', e.title));
  return paths;
end $$;

create or replace function public.order_json(o public.orders) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'reference', o.reference, 'status', o.status, 'totalCents', o.total_cents, 'currency', o.currency,
    'taxCents', o.tax_cents, 'createdAt', o.created_at, 'paidAt', o.paid_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('ebookId', i.ebook_id, 'title', i.title, 'priceCents', i.price_cents)) from public.order_items i where i.order_id = o.id), '[]'))
$$;

create or replace function public.my_orders() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.order_json(o) order by o.created_at desc), '[]') from public.orders o where o.user_id = public.current_active_uid()
$$;

-- Statut d'une commande : filtré par propriétaire (un autre compte reçoit « introuvable »).
create or replace function public.my_order(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_id and user_id = public.current_active_uid();
  if o.id is null then raise exception 'Commande introuvable.' using errcode = 'P0404'; end if;
  return public.order_json(o);
end $$;

create or replace function public.admin_orders(p_q text default null, p_status text default null, p_page int default 1) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pg int := greatest(coalesce(p_page, 1), 1); q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform public.require_admin();
  return (
    with base as (
      select o.* from public.orders o left join public.profiles u on u.id = o.user_id
      where q is null or o.reference ilike '%' || q || '%' or u.email ilike '%' || q || '%'),
    f as (select * from base where p_status is null or p_status = '' or status::text = p_status)
    select jsonb_build_object(
      'total', (select count(*) from f), 'page', pg, 'pageSize', 25,
      'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from base group by status) c), '{}'),
      'items', coalesce((select jsonb_agg(public.order_json(x) || jsonb_build_object('user', jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email)) order by x.created_at desc)
        from (select * from f order by created_at desc offset (pg - 1) * 25 limit 25) x join public.profiles u on u.id = x.user_id), '[]')));
end $$;

create or replace function public.admin_order(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  perform public.require_admin();
  select * into o from public.orders where id = p_id;
  if o.id is null then raise exception 'Commande introuvable.' using errcode = 'P0404'; end if;
  return public.order_json(o) || jsonb_build_object(
    'user', (select jsonb_build_object('id', id, 'name', name, 'email', email) from public.profiles where id = o.user_id),
    'taxCountry', o.tax_country, 'failedAt', o.failed_at, 'refundedAt', o.refunded_at, 'canceledAt', o.canceled_at,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'providerSessionId', provider_session_id, 'providerPaymentId', provider_payment_id,
       'status', status, 'amountCents', amount_cents, 'currency', currency, 'failureReason', failure_reason, 'createdAt', created_at)) from public.payments where order_id = o.id), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'type', type, 'outcome', outcome, 'providerEventId', provider_event_id, 'receivedAt', received_at) order by received_at)
       from public.payment_events where order_id = o.id), '[]'));
end $$;

create or replace function public.admin_users(p_q text default null, p_status text default null, p_role text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'role', u.role, 'status', u.status, 'createdAt', u.created_at,
      'paidOrders', (select count(*) from public.orders o where o.user_id = u.id and o.status = 'PAID'),
      'ebooks', (select count(*) from public.entitlements en where en.user_id = u.id and en.revoked_at is null)) order by u.created_at desc)
    from (select * from public.profiles u
          where (q is null or u.email ilike '%' || q || '%' or u.name ilike '%' || q || '%')
            and (p_status is null or p_status = '' or u.status::text = p_status)
            and (p_role is null or p_role = '' or u.role::text = p_role)
          order by created_at desc limit 200) u), '[]');
end $$;

create or replace function public.admin_user(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.require_admin();
  select jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'role', u.role, 'status', u.status, 'createdAt', u.created_at,
    'marketingConsent', u.marketing_consent, 'deletedAt', u.deleted_at,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'reference', o.reference, 'status', o.status, 'totalCents', o.total_cents, 'currency', o.currency, 'createdAt', o.created_at) order by o.created_at desc) from public.orders o where o.user_id = u.id), '[]'),
    'entitlements', coalesce((select jsonb_agg(jsonb_build_object('grantedAt', en.granted_at, 'ebook', jsonb_build_object('id', e.id, 'title', e.title)))
       from public.entitlements en join public.ebooks e on e.id = en.ebook_id where en.user_id = u.id and en.revoked_at is null), '[]'),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'platform', d.platform, 'lastSeenAt', d.last_seen_at)) from public.devices d where d.user_id = u.id), '[]'))
  into r from public.profiles u where u.id = p_id;
  if r is null then raise exception 'Utilisateur introuvable.' using errcode = 'P0404'; end if;
  return r;
end $$;

create or replace function public.admin_set_user_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare admin uuid := public.require_admin(); cur public.user_status;
begin
  if p_id = admin then raise exception 'Vous ne pouvez pas modifier votre propre statut.'; end if;
  if p_status not in ('ACTIVE', 'SUSPENDED') then raise exception 'Statut invalide.'; end if;
  select status into cur from public.profiles where id = p_id;
  if cur is null then raise exception 'Utilisateur introuvable.' using errcode = 'P0404'; end if;
  if cur = 'DELETED' then raise exception 'Ce compte est supprimé.' using errcode = 'P0409'; end if;
  update public.profiles set status = p_status::public.user_status, updated_at = now() where id = p_id;
  perform public.audit(case p_status when 'SUSPENDED' then 'user.suspend' else 'user.reactivate' end, 'user', p_id::text);
  return public.admin_user(p_id);
end $$;

create or replace function public.admin_export_user(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  perform public.audit('user.export', 'user', p_id::text);
  return jsonb_build_object('exportedAt', now(), 'profile', (select to_jsonb(p) from public.profiles p where id = p_id),
    'orders', coalesce((select jsonb_agg(public.order_json(o)) from public.orders o where o.user_id = p_id), '[]'),
    'library', coalesce((select jsonb_agg(jsonb_build_object('title', e.title, 'grantedAt', en.granted_at, 'revokedAt', en.revoked_at))
       from public.entitlements en join public.ebooks e on e.id = en.ebook_id where en.user_id = p_id), '[]'),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'platform', platform, 'createdAt', created_at)) from public.devices where user_id = p_id), '[]'));
end $$;

-- Indicateurs : le chiffre d'affaires ne compte que les commandes PAID (remboursements exclus, CA-26).
create or replace function public.admin_stats(p_period text default '30d') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz := now() - case p_period when '7d' then interval '7 days' when '90d' then interval '90 days' when '12m' then interval '365 days' else interval '30 days' end;
  rev bigint; n bigint; failed bigint;
begin
  perform public.require_admin();
  select coalesce(sum(total_cents), 0), count(*) into rev, n from public.orders where status = 'PAID' and paid_at >= since;
  select count(*) into failed from public.orders where status = 'FAILED' and created_at >= since;
  return jsonb_build_object(
    'period', coalesce(p_period, '30d'), 'since', since, 'currency', 'EUR',
    'revenueCents', rev, 'paidOrders', n,
    'averageOrderCents', case when n > 0 then round(rev::numeric / n) else 0 end,
    'failureRate', case when n + failed > 0 then failed::numeric / (n + failed) else 0 end,
    'ordersByStatus', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from public.orders where created_at >= since group by status) s), '{}'),
    'views', (select count(*) from public.ebook_views where created_at >= since),
    'activeCustomers', (select count(*) from public.profiles where role = 'CUSTOMER' and status = 'ACTIVE'),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('week', w, 'revenueCents', r, 'orders', c) order by w) from (
       select date_trunc('week', paid_at) w, sum(total_cents) r, count(*) c from public.orders where status = 'PAID' and paid_at >= since group by 1) x), '[]'),
    'topEbooks', coalesce((select jsonb_agg(t order by (t->>'sales')::int desc, (t->>'views')::int desc) from (
       select jsonb_build_object('id', e.id, 'title', e.title,
         'sales', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where i.ebook_id = e.id and o.status = 'PAID' and o.paid_at >= since),
         'revenueCents', (select coalesce(sum(i.price_cents), 0) from public.order_items i join public.orders o on o.id = i.order_id where i.ebook_id = e.id and o.status = 'PAID' and o.paid_at >= since),
         'views', (select count(*) from public.ebook_views v where v.ebook_id = e.id and v.created_at >= since)) t
       from public.ebooks e order by 1 limit 50) y), '[]'),
    'recentOrders', coalesce((select jsonb_agg(public.order_json(o) || jsonb_build_object('user', jsonb_build_object('name', u.name, 'email', u.email)) order by o.created_at desc)
       from (select * from public.orders order by created_at desc limit 6) o join public.profiles u on u.id = o.user_id), '[]'));
end $$;

create or replace function public.admin_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin perform public.require_admin(); return public.app_settings(); end $$;

create or replace function public.admin_put_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare allowed text[] := array['appName','checkoutMode','webCheckoutUrl','maxDevices','maxDownloadsPerBook','supportEmail','termsUrl','salesTermsUrl','privacyUrl','legalNoticeUrl'];
  clean jsonb;
begin
  perform public.require_admin();
  select coalesce(jsonb_object_agg(key, value), '{}') into clean from jsonb_each(p) where key = any(allowed);
  if clean ? 'checkoutMode' and not ((clean->'checkoutMode'->>'ios') in ('external', 'web_only') and (clean->'checkoutMode'->>'android') in ('external', 'web_only')) then
    raise exception 'checkoutMode : external ou web_only.';
  end if;
  insert into public.settings (key, value) values ('app', clean)
  on conflict (key) do update set value = public.settings.value || excluded.value, updated_at = now();
  perform public.audit('settings.update', 'settings', 'app', clean);
  return public.app_settings();
end $$;

create or replace function public.admin_audit_logs(p_page int default 1) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'targetType', l.target_type, 'targetId', l.target_id, 'meta', l.meta, 'createdAt', l.created_at,
     'actor', case when p.id is null then null else jsonb_build_object('name', p.name, 'email', p.email) end) order by l.created_at desc)
    from (select * from public.audit_logs order by created_at desc offset (greatest(p_page, 1) - 1) * 50 limit 50) l left join public.profiles p on p.id = l.actor_id), '[]');
end $$;

-- ── Droits d'exécution ──────────────────────────────────────────

revoke execute on all functions in schema public from public, anon, authenticated;

-- is_admin est aussi utilisée par les règles RLS lues par les visiteurs (elle renvoie alors false).
grant execute on function public.norm(text), public.is_admin(), public.public_config(), public.search_ebooks(text, text, text, int, int), public.catalog_home(), public.ebook_detail(text)
  to anon, authenticated;
grant execute on function public.is_admin(), public.me(), public.update_my_profile(text), public.set_notification_prefs(boolean, boolean),
  public.register_device(text, text, text), public.remove_device(uuid), public.my_export(),
  public.cart_get(), public.cart_add(uuid), public.cart_remove(uuid), public.cart_merge(uuid[]),
  public.my_library(), public.save_progress(uuid, int, int, int), public.my_orders(), public.my_order(uuid),
  public.admin_ebooks(text, text), public.admin_ebook(uuid), public.admin_save_ebook(uuid, jsonb), public.admin_set_ebook_status(uuid, text),
  public.admin_delete_ebook(uuid), public.admin_orders(text, text, int), public.admin_order(uuid), public.admin_users(text, text, text),
  public.admin_user(uuid), public.admin_set_user_status(uuid, text), public.admin_export_user(uuid), public.admin_stats(text),
  public.admin_get_settings(), public.admin_put_settings(jsonb), public.admin_audit_logs(int)
  to authenticated;
-- Les fonctions svc_*, anonymize_user, cancel_stale_orders restent réservées à service_role.
grant execute on all functions in schema public to service_role;

-- ── Règles d'accès (RLS) ────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.devices enable row level security;
alter table public.categories enable row level security;
alter table public.ebooks enable row level security;
alter table public.ebook_files enable row level security;
alter table public.ebook_views enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.entitlements enable row level security;
alter table public.download_events enable row level security;
alter table public.reading_progress enable row level security;
alter table public.settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.email_outbox enable row level security;

-- Lecture seule pour les clients ; toutes les écritures passent par les fonctions ci-dessus.
create policy "profil : soi-même ou admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "préférences : soi-même" on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy "appareils : soi-même" on public.devices for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "catégories : public" on public.categories for select to anon, authenticated using (true);
create policy "e-books publiés : public" on public.ebooks for select to anon, authenticated using (status = 'PUBLISHED' or public.is_admin());
create policy "fichiers : admin" on public.ebook_files for select to authenticated using (public.is_admin());
create policy "panier : soi-même" on public.cart_items for select to authenticated using (user_id = auth.uid());
create policy "commandes : soi-même ou admin" on public.orders for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "lignes : soi-même ou admin" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
create policy "paiements : admin" on public.payments for select to authenticated using (public.is_admin());
create policy "événements : admin" on public.payment_events for select to authenticated using (public.is_admin());
create policy "droits : soi-même ou admin" on public.entitlements for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "progression : soi-même" on public.reading_progress for select to authenticated using (user_id = auth.uid());
create policy "téléchargements : admin" on public.download_events for select to authenticated using (public.is_admin());
create policy "consultations : admin" on public.ebook_views for select to authenticated using (public.is_admin());
create policy "journal : admin" on public.audit_logs for select to authenticated using (public.is_admin());
-- settings et email_outbox : aucune policy, accès via fonctions / service_role uniquement.

-- ── Stockage ────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('covers', 'covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('ebooks', 'ebooks', false, 104857600, array['application/epub+zip', 'application/pdf', 'application/json'])
on conflict (id) do nothing;
-- Aucune policy sur storage.objects pour « ebooks » : seules les Edge Functions (service_role)
-- lisent les fichiers et émettent des URL signées de 5 minutes.

-- ── Tâche planifiée ─────────────────────────────────────────────

create extension if not exists pg_cron;
select cron.schedule('folio-cancel-stale-orders', '*/5 * * * *', $$select public.cancel_stale_orders(60)$$);

-- Export CSV des commandes (sans donnée bancaire) : lignes brutes, mises en forme par l'admin.
create or replace function public.admin_orders_export(p_q text default null, p_status text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q text := nullif(trim(coalesce(p_q, '')), ''); rows jsonb;
begin
  perform public.require_admin();
  select coalesce(jsonb_agg(jsonb_build_object('reference', o.reference, 'date', o.created_at, 'statut', o.status, 'client', u.name, 'email', u.email,
      'articles', (select string_agg(i.title, ' | ') from public.order_items i where i.order_id = o.id),
      'total', to_char(o.total_cents / 100.0, 'FM999999990.00'), 'devise', o.currency,
      'tva', case when o.tax_cents is null then '' else to_char(o.tax_cents / 100.0, 'FM999999990.00') end, 'pays', coalesce(o.tax_country, ''))
    order by o.created_at desc), '[]') into rows
  from public.orders o join public.profiles u on u.id = o.user_id
  where (q is null or o.reference ilike '%' || q || '%' or u.email ilike '%' || q || '%')
    and (p_status is null or p_status = '' or o.status::text = p_status);
  perform public.audit('orders.export', 'orders', null, jsonb_build_object('count', jsonb_array_length(rows), 'q', p_q, 'status', p_status));
  return rows;
end $$;
revoke execute on function public.admin_orders_export(text, text) from public, anon;
grant execute on function public.admin_orders_export(text, text) to authenticated;
