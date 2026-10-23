-- Codes d'erreur PostgREST : PTxyz donne directement le statut HTTP xyz (les codes P04xx renvoyaient 500).

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
    raise exception 'Nombre maximal d''appareils atteint (%). Retirez un appareil depuis votre compte.', lim using errcode = 'PT409';
  end if;
  insert into public.devices (user_id, device_key, label, platform) values (uid, left(p_key, 100), left(coalesce(p_label, 'Appareil'), 100), left(coalesce(p_platform, 'inconnu'), 20))
  returning id into did;
  return did;
end $$;

create or replace function public.ebook_detail(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; is_owned boolean;
begin
  select * into e from public.ebooks where slug = p_slug;
  is_owned := e.id is not null and e.id = any(public.owned_ids(auth.uid()));
  if e.id is null or (e.status <> 'PUBLISHED' and not is_owned) then
    raise exception 'E-book introuvable.' using errcode = 'PT404';
  end if;
  insert into public.ebook_views (ebook_id) values (e.id);
  return public.ebook_json(e, is_owned);
end $$;

create or replace function public.cart_add(p_ebook uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  if not exists (select 1 from public.ebooks where id = p_ebook and status = 'PUBLISHED' and price_cents is not null) then
    raise exception 'E-book indisponible.' using errcode = 'PT404';
  end if;
  if p_ebook = any(public.owned_ids(uid)) then
    raise exception 'Cet e-book est déjà dans votre bibliothèque.' using errcode = 'PT409';
  end if;
  insert into public.cart_items (user_id, ebook_id) values (uid, p_ebook) on conflict do nothing;
  return public.cart_get();
end $$;

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
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Votre panier est vide.' using errcode = 'PT400'; end if;
  select count(*), count(distinct currency), sum(price_cents) into n, curs, total
  from public.ebooks where id = any(ids) and status = 'PUBLISHED' and price_cents is not null;
  if n <> array_length(ids, 1) then raise exception 'Un e-book de votre panier n''est plus disponible.' using errcode = 'PT409'; end if;
  if curs > 1 then raise exception 'Les e-books du panier doivent avoir la même devise.' using errcode = 'PT400'; end if;
  select e.title into owned_title from public.entitlements en join public.ebooks e on e.id = en.ebook_id
  where en.user_id = p_user and en.ebook_id = any(ids) and en.revoked_at is null limit 1;
  if owned_title is not null then raise exception '« % » est déjà dans votre bibliothèque.', owned_title using errcode = 'PT409'; end if;
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

create or replace function public.admin_ebook(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.ebooks;
begin
  perform public.require_admin();
  select * into e from public.ebooks where id = p_id;
  if e.id is null then raise exception 'E-book introuvable.' using errcode = 'PT404'; end if;
  return public.admin_ebook_json(e);
end $$;

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
    if e.id is null then raise exception 'E-book introuvable.' using errcode = 'PT404'; end if;
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
  if e.id is null then raise exception 'E-book introuvable.' using errcode = 'PT404'; end if;
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

create or replace function public.admin_delete_ebook(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; paths jsonb;
begin
  perform public.require_admin();
  select * into e from public.ebooks where id = p_id;
  if e.id is null then raise exception 'E-book introuvable.' using errcode = 'PT404'; end if;
  if e.status <> 'DRAFT' or exists (select 1 from public.order_items where ebook_id = p_id) or exists (select 1 from public.entitlements where ebook_id = p_id) then
    raise exception 'Seul un brouillon jamais commandé peut être supprimé. Archivez-le plutôt.' using errcode = 'PT409';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('path', storage_path, 'kind', kind)), '[]') into paths from public.ebook_files where ebook_id = p_id;
  delete from public.ebooks where id = p_id;
  perform public.audit('ebook.delete', 'ebook', p_id::text, jsonb_build_object('title', e.title));
  return paths;
end $$;

create or replace function public.my_order(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_id and user_id = public.current_active_uid();
  if o.id is null then raise exception 'Commande introuvable.' using errcode = 'PT404'; end if;
  return public.order_json(o);
end $$;

create or replace function public.admin_order(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  perform public.require_admin();
  select * into o from public.orders where id = p_id;
  if o.id is null then raise exception 'Commande introuvable.' using errcode = 'PT404'; end if;
  return public.order_json(o) || jsonb_build_object(
    'user', (select jsonb_build_object('id', id, 'name', name, 'email', email) from public.profiles where id = o.user_id),
    'taxCountry', o.tax_country, 'failedAt', o.failed_at, 'refundedAt', o.refunded_at, 'canceledAt', o.canceled_at,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'providerSessionId', provider_session_id, 'providerPaymentId', provider_payment_id,
       'status', status, 'amountCents', amount_cents, 'currency', currency, 'failureReason', failure_reason, 'createdAt', created_at)) from public.payments where order_id = o.id), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'type', type, 'outcome', outcome, 'providerEventId', provider_event_id, 'receivedAt', received_at) order by received_at)
       from public.payment_events where order_id = o.id), '[]'));
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
  if r is null then raise exception 'Utilisateur introuvable.' using errcode = 'PT404'; end if;
  return r;
end $$;

create or replace function public.admin_set_user_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare admin uuid := public.require_admin(); cur public.user_status;
begin
  if p_id = admin then raise exception 'Vous ne pouvez pas modifier votre propre statut.'; end if;
  if p_status not in ('ACTIVE', 'SUSPENDED') then raise exception 'Statut invalide.'; end if;
  select status into cur from public.profiles where id = p_id;
  if cur is null then raise exception 'Utilisateur introuvable.' using errcode = 'PT404'; end if;
  if cur = 'DELETED' then raise exception 'Ce compte est supprimé.' using errcode = 'PT409'; end if;
  update public.profiles set status = p_status::public.user_status, updated_at = now() where id = p_id;
  perform public.audit(case p_status when 'SUSPENDED' then 'user.suspend' else 'user.reactivate' end, 'user', p_id::text);
  return public.admin_user(p_id);
end $$;
