-- Marketplace multi-vendeurs, livres physiques et numériques, coordonnées de paiement chiffrées,
-- Mobile Money (réglages admin + historique), gains et reversements. Voir docs/08-plan-marketplace.md.

-- ── Livres : vendeur, type, langue, état, stock ─────────────────

alter table public.ebooks
  add column seller_id uuid references public.profiles (id),
  add column kind public.product_kind not null default 'DIGITAL',
  add column language text not null default 'fr',
  add column condition public.book_condition,
  add column stock int check (stock is null or stock >= 0);
alter table public.ebooks add constraint ebooks_digital_no_stock
  check (kind = 'PHYSICAL' or (stock is null and condition is null));
alter table public.ebooks add constraint ebooks_currency check (currency in ('EUR', 'KMF', 'MGA'));
create index on public.ebooks (seller_id);
comment on column public.ebooks.seller_id is 'Vendeur ; vide = livre de la plateforme (géré par l’admin, sans commission).';

create table public.ebook_shipping_options (
  id uuid primary key default gen_random_uuid(),
  ebook_id uuid not null references public.ebooks (id) on delete cascade,
  mode public.shipping_mode not null,
  price_cents int not null default 0 check (price_cents >= 0),
  countries text[] not null default '{}',
  delay_days int check (delay_days is null or delay_days between 0 and 90),
  unique (ebook_id, mode)
);

create table public.shipping_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  full_name text not null,
  line1 text not null,
  line2 text,
  city text not null,
  postal_code text,
  country text not null check (country ~ '^[A-Z]{2}$'),
  phone text,
  created_at timestamptz not null default now()
);

-- ── Commandes : vendeur par ligne, livraison, moyen de paiement ──

alter table public.orders
  add column payment_method text not null default 'CARD' check (payment_method in ('CARD', 'MOBILE_MONEY')),
  add column shipping_address jsonb,
  add column stock_reserved boolean not null default false;

alter table public.order_items
  add column seller_id uuid references public.profiles (id),
  add column kind public.product_kind not null default 'DIGITAL',
  add column quantity int not null default 1 check (quantity > 0),
  add column shipping_mode public.shipping_mode,
  add column shipping_cents int not null default 0;

alter table public.payments
  add column method text not null default 'CARD',
  add column country text,
  add column operator text,
  add column msisdn_last4 text;

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  seller_id uuid references public.profiles (id),
  buyer_id uuid not null references public.profiles (id),
  status public.shipment_status not null default 'TO_SHIP',
  address jsonb not null,
  tracking text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index shipments_order_seller on public.shipments (order_id, coalesce(seller_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ── Coordonnées de paiement des vendeurs (chiffrées par la fonction Edge payout-accounts) ──

create table public.seller_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.payout_account_kind not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  operator text,
  holder_name text not null,
  bank_name text,
  secret_ciphertext text not null,  -- IBAN/RIB ou numéro, AES-256-GCM ; jamais en clair
  last4 text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  check (kind = 'BANK' or operator is not null)
);
create unique index seller_payout_default on public.seller_payout_accounts (user_id) where is_default;

-- ── Gains et reversements ───────────────────────────────────────

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id),
  account_id uuid references public.seller_payout_accounts (id) on delete set null,
  method public.payout_account_kind not null,
  currency text not null,
  amount_cents int not null check (amount_cents > 0),
  status public.payout_status not null default 'PROCESSING',
  provider_ref text,
  reference text,
  failure_reason text,
  created_by uuid references public.profiles (id),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.seller_earnings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  reason text not null default 'SALE' check (reason in ('SALE', 'REFUND')),
  currency text not null,
  gross_cents int not null,
  commission_cents int not null,
  net_cents int not null,
  status public.earning_status not null default 'AVAILABLE',
  payout_id uuid references public.payouts (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (order_item_id, reason)
);
create index on public.seller_earnings (seller_id, status);

-- ── Historique des réglages Mobile Money ────────────────────────

create table public.payment_settings_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────

alter table public.ebook_shipping_options enable row level security;
alter table public.shipping_addresses enable row level security;
alter table public.shipments enable row level security;
alter table public.seller_payout_accounts enable row level security;
alter table public.payouts enable row level security;
alter table public.seller_earnings enable row level security;
alter table public.payment_settings_log enable row level security;

drop policy "e-books publiés : public" on public.ebooks;
create policy "livres publiés, ou les miens, ou admin" on public.ebooks for select to anon, authenticated
  using (status = 'PUBLISHED' or seller_id = auth.uid() or public.is_admin());
create policy "livraison : publique" on public.ebook_shipping_options for select to anon, authenticated using (true);
create policy "adresses : soi-même" on public.shipping_addresses for select to authenticated using (user_id = auth.uid());
create policy "expéditions : acheteur, vendeur ou admin" on public.shipments for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.is_admin());
create policy "gains : vendeur ou admin" on public.seller_earnings for select to authenticated using (seller_id = auth.uid() or public.is_admin());
create policy "versements : vendeur ou admin" on public.payouts for select to authenticated using (seller_id = auth.uid() or public.is_admin());
-- seller_payout_accounts et payment_settings_log : aucune lecture directe (le chiffré ne sort jamais) ; accès par fonctions.

-- ── Paramètres : commission et Mobile Money ─────────────────────

create or replace function public.app_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'appName', 'Folio',
    'checkoutMode', jsonb_build_object('ios', 'external', 'android', 'external'),
    'webCheckoutUrl', null, 'maxDevices', null, 'maxDownloadsPerBook', null, 'supportEmail', null,
    'termsUrl', null, 'salesTermsUrl', null, 'privacyUrl', null, 'legalNoticeUrl', null,
    'commissionPercent', 2
  ) || coalesce((select value from public.settings where key = 'app'), '{}'::jsonb)
$$;

create or replace function public.mobile_money_defaults() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "enabled": false,
    "payoutsEnabled": true,
    "countries": {
      "KM": {"enabled": true, "name": "Comores", "currency": "KMF", "dialCode": "+269",
             "operators": {"HURI_MONEY": {"enabled": true, "label": "Huri Money"},
                           "MVOLA_KM": {"enabled": true, "label": "Mvola Comores"}}},
      "MG": {"enabled": true, "name": "Madagascar", "currency": "MGA", "dialCode": "+261",
             "operators": {"MVOLA": {"enabled": true, "label": "MVola"},
                           "ORANGE_MONEY": {"enabled": true, "label": "Orange Money"},
                           "AIRTEL_MONEY": {"enabled": true, "label": "Airtel Money"}}}
    }
  }'::jsonb
$$;

-- Réglage stocké en base (clé « mobile_money ») ; seuls les interrupteurs y sont enregistrés.
create or replace function public.mobile_money_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d jsonb := public.mobile_money_defaults(); s jsonb := coalesce((select value from public.settings where key = 'mobile_money'), '{}'::jsonb);
  c text; o text;
begin
  if s ? 'enabled' then d := jsonb_set(d, '{enabled}', s->'enabled'); end if;
  if s ? 'payoutsEnabled' then d := jsonb_set(d, '{payoutsEnabled}', s->'payoutsEnabled'); end if;
  for c in select jsonb_object_keys(d->'countries') loop
    if s #> array['countries', c, 'enabled'] is not null then d := jsonb_set(d, array['countries', c, 'enabled'], s #> array['countries', c, 'enabled']); end if;
    for o in select jsonb_object_keys(d #> array['countries', c, 'operators']) loop
      if s #> array['countries', c, 'operators', o, 'enabled'] is not null then
        d := jsonb_set(d, array['countries', c, 'operators', o, 'enabled'], s #> array['countries', c, 'operators', o, 'enabled']);
      end if;
    end loop;
  end loop;
  return d;
end $$;

create or replace function public.mobile_money_available(p_country text, p_operator text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((s->>'enabled')::boolean, false)
     and coalesce((s #>> array['countries', p_country, 'enabled'])::boolean, false)
     and coalesce((s #>> array['countries', p_country, 'operators', p_operator, 'enabled'])::boolean, false)
  from (select public.mobile_money_settings() s) x
$$;

-- Configuration publique : seuls les pays et opérateurs actifs sont exposés aux acheteurs.
create or replace function public.public_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select public.app_settings() a, public.mobile_money_settings() m)
  select jsonb_build_object(
    'appName', a->'appName', 'checkoutMode', a->'checkoutMode', 'webCheckoutUrl', a->'webCheckoutUrl', 'supportEmail', a->'supportEmail',
    'legal', jsonb_build_object('terms', a->'termsUrl', 'salesTerms', a->'salesTermsUrl', 'privacy', a->'privacyUrl', 'legalNotice', a->'legalNoticeUrl'),
    'mobileMoney', jsonb_build_object(
      'enabled', coalesce((m->>'enabled')::boolean, false),
      'countries', case when coalesce((m->>'enabled')::boolean, false) then coalesce((
        select jsonb_agg(jsonb_build_object('code', c.key, 'name', c.value->>'name', 'currency', c.value->>'currency', 'dialCode', c.value->>'dialCode',
          'operators', (select coalesce(jsonb_agg(jsonb_build_object('code', o.key, 'label', o.value->>'label') order by o.key), '[]')
                        from jsonb_each(c.value->'operators') o where (o.value->>'enabled')::boolean)) order by c.key)
        from jsonb_each(m->'countries') c
        where (c.value->>'enabled')::boolean
          and exists (select 1 from jsonb_each(c.value->'operators') o where (o.value->>'enabled')::boolean)), '[]') else '[]'::jsonb end))
  from s
$$;

create or replace function public.admin_get_mobile_money() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin perform public.require_admin(); return public.mobile_money_settings(); end $$;

-- Enregistre les interrupteurs (booléens seulement), journalise avant / après.
create or replace function public.admin_set_mobile_money(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare admin uuid := public.require_admin(); before jsonb := public.mobile_money_settings(); d jsonb := public.mobile_money_defaults();
  clean jsonb := '{"countries": {}}'::jsonb; c text; o text; v jsonb; after jsonb;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'Réglage invalide.' using errcode = 'PT400'; end if;
  foreach c in array array['enabled', 'payoutsEnabled'] loop
    v := p->c;
    if v is not null then
      if jsonb_typeof(v) <> 'boolean' then raise exception '« % » doit être vrai ou faux.', c using errcode = 'PT400'; end if;
      clean := clean || jsonb_build_object(c, v);
    end if;
  end loop;
  for c in select jsonb_object_keys(coalesce(p->'countries', '{}')) loop
    if not (d->'countries') ? c then raise exception 'Pays inconnu : %.', c using errcode = 'PT400'; end if;
    v := p #> array['countries', c, 'enabled'];
    if v is not null and jsonb_typeof(v) <> 'boolean' then raise exception 'Valeur invalide pour %.', c using errcode = 'PT400'; end if;
    clean := jsonb_set(clean, array['countries', c], jsonb_strip_nulls(jsonb_build_object('enabled', v, 'operators', '{}'::jsonb)));
    for o in select jsonb_object_keys(coalesce(p #> array['countries', c, 'operators'], '{}')) loop
      if not (d #> array['countries', c, 'operators']) ? o then raise exception 'Opérateur inconnu : %.', o using errcode = 'PT400'; end if;
      v := p #> array['countries', c, 'operators', o, 'enabled'];
      if jsonb_typeof(v) is distinct from 'boolean' then raise exception 'Valeur invalide pour %.', o using errcode = 'PT400'; end if;
      clean := jsonb_set(clean, array['countries', c, 'operators', o], jsonb_build_object('enabled', v));
    end loop;
  end loop;
  -- Fusion avec le réglage existant (on ne perd pas les interrupteurs non envoyés).
  insert into public.settings (key, value) values ('mobile_money', '{}') on conflict (key) do nothing;
  update public.settings set value = public.jsonb_deep_merge(value, clean), updated_at = now() where key = 'mobile_money';
  after := public.mobile_money_settings();
  if after is distinct from before then
    insert into public.payment_settings_log (actor_id, before, after) values (admin, before, after);
    perform public.audit('payments.mobile_money', 'settings', 'mobile_money', jsonb_build_object('before', before, 'after', after));
  end if;
  return after;
end $$;

create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then
    coalesce((select jsonb_object_agg(k, case when a ? k and b ? k then public.jsonb_deep_merge(a->k, b->k) when b ? k then b->k else a->k end)
              from (select jsonb_object_keys(a) k union select jsonb_object_keys(b)) keys), '{}'::jsonb)
  else b end
$$;

create or replace function public.admin_mobile_money_log() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'createdAt', l.created_at, 'before', l.before, 'after', l.after,
      'actor', case when p.id is null then null else jsonb_build_object('name', p.name, 'email', p.email) end) order by l.created_at desc)
    from (select * from public.payment_settings_log order by created_at desc limit 200) l left join public.profiles p on p.id = l.actor_id), '[]');
end $$;

create or replace function public.admin_put_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare allowed text[] := array['appName','checkoutMode','webCheckoutUrl','maxDevices','maxDownloadsPerBook','supportEmail','termsUrl','salesTermsUrl','privacyUrl','legalNoticeUrl','commissionPercent'];
  clean jsonb;
begin
  perform public.require_admin();
  select coalesce(jsonb_object_agg(key, value), '{}') into clean from jsonb_each(p) where key = any(allowed);
  if clean ? 'checkoutMode' and not ((clean->'checkoutMode'->>'ios') in ('external', 'web_only') and (clean->'checkoutMode'->>'android') in ('external', 'web_only')) then
    raise exception 'checkoutMode : external ou web_only.' using errcode = 'PT400';
  end if;
  if clean ? 'commissionPercent' and (jsonb_typeof(clean->'commissionPercent') <> 'number' or (clean->>'commissionPercent')::numeric not between 0 and 50) then
    raise exception 'La commission doit être comprise entre 0 et 50 %%.' using errcode = 'PT400';
  end if;
  insert into public.settings (key, value) values ('app', clean)
  on conflict (key) do update set value = public.settings.value || excluded.value, updated_at = now();
  perform public.audit('settings.update', 'settings', 'app', clean);
  return public.app_settings();
end $$;

-- ── Représentation d'un livre ───────────────────────────────────

create or replace function public.ebook_json(e public.ebooks, owned boolean default false) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'title', e.title, 'author', e.author, 'description', e.description,
    'category', (select jsonb_build_object('name', c.name, 'slug', c.slug) from public.categories c where c.id = e.category_id),
    'priceCents', e.price_cents, 'currency', e.currency, 'format', e.format, 'pages', e.pages,
    'downloadAllowed', e.download_allowed, 'publishedAt', e.published_at,
    'kind', e.kind, 'language', e.language, 'condition', e.condition, 'stock', e.stock,
    'inStock', e.kind = 'DIGITAL' or coalesce(e.stock, 0) > 0,
    'seller', (select jsonb_build_object('id', p.id, 'name', p.name) from public.profiles p where p.id = e.seller_id),
    'shipping', case when e.kind = 'PHYSICAL' then coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'mode', s.mode, 'priceCents', s.price_cents,
        'countries', to_jsonb(s.countries), 'delayDays', s.delay_days) order by s.price_cents) from public.ebook_shipping_options s where s.ebook_id = e.id), '[]') else '[]'::jsonb end,
    'cover', jsonb_build_object('bg', e.cover_bg, 'fg', e.cover_fg, 'tint', e.cover_tint,
      'path', (select f.storage_path from public.ebook_files f where f.ebook_id = e.id and f.kind = 'COVER' order by f.created_at desc limit 1)),
    'owned', owned)
$$;

-- Conditions de publication selon le type de livre (liste vide = publiable).
create or replace function public.book_problems(e public.ebooks) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when e.price_cents is null then 'Prix à définir' end,
    case when trim(e.description) = '' then 'Description manquante' end,
    case when e.category_id is null then 'Catégorie manquante' end,
    case when e.kind = 'DIGITAL' and not exists (select 1 from public.ebook_files f where f.ebook_id = e.id and f.kind = 'MAIN') then 'Fichier du livre manquant (PDF ou EPUB)' end,
    case when e.kind = 'PHYSICAL' and e.condition is null then 'État du livre manquant' end,
    case when e.kind = 'PHYSICAL' and e.stock is null then 'Quantité en stock manquante' end,
    case when e.kind = 'PHYSICAL' and not exists (select 1 from public.ebook_shipping_options s where s.ebook_id = e.id) then 'Au moins un mode de livraison' end
  ], null)
$$;

create or replace function public.admin_ebook_json(e public.ebooks) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.ebook_json(e) || jsonb_build_object(
    'status', e.status, 'featured', e.featured, 'previewBlocks', e.preview_blocks, 'createdAt', e.created_at, 'updatedAt', e.updated_at,
    'sales', (select coalesce(sum(i.quantity), 0) from public.order_items i join public.orders o on o.id = i.order_id where i.ebook_id = e.id and o.status = 'PAID'),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'mimeType', f.mime_type, 'sizeBytes', f.size_bytes, 'originalName', f.original_name, 'createdAt', f.created_at) order by f.created_at)
                       from public.ebook_files f where f.ebook_id = e.id), '[]'),
    'publishable', to_jsonb(public.book_problems(e)))
$$;

-- ── Catalogue ───────────────────────────────────────────────────

drop function if exists public.search_ebooks(text, text, text, int, int);
create function public.search_ebooks(p_q text default null, p_category text default null, p_sort text default 'new', p_page int default 1, p_page_size int default 20, p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owned uuid[] := public.owned_ids(auth.uid());
  words text[] := case when coalesce(trim(p_q), '') = '' then '{}' else regexp_split_to_array(public.norm(trim(p_q)), '\s+') end;
  sz int := least(greatest(coalesce(p_page_size, 20), 1), 50);
  pg int := greatest(coalesce(p_page, 1), 1);
  result jsonb;
begin
  if p_kind is not null and p_kind <> '' and p_kind not in ('PHYSICAL', 'DIGITAL') then
    raise exception 'Type de livre inconnu.' using errcode = 'PT400';
  end if;
  with f as (
    select e.* from public.ebooks e
    left join public.categories c on c.id = e.category_id
    where e.status = 'PUBLISHED' and e.price_cents is not null
      and (p_category is null or p_category = '' or c.slug = p_category)
      and (p_kind is null or p_kind = '' or e.kind::text = p_kind)
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

-- ── Panier ──────────────────────────────────────────────────────

create or replace function public.cart_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); owned uuid[] := public.owned_ids(uid); removed jsonb;
begin
  -- Retirés du panier : dépubliés, sans prix, numériques déjà acquis, physiques épuisés, livres du vendeur lui-même.
  with del as (
    delete from public.cart_items ci using public.ebooks e
    where ci.user_id = uid and e.id = ci.ebook_id and (e.status <> 'PUBLISHED' or e.price_cents is null
      or (e.kind = 'DIGITAL' and e.id = any(owned)) or (e.kind = 'PHYSICAL' and coalesce(e.stock, 0) = 0) or e.seller_id = uid)
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
      'currencies', coalesce(to_jsonb(array_agg(distinct e.currency) filter (where e.currency is not null)), '[]'),
      'hasPhysical', coalesce(bool_or(e.kind = 'PHYSICAL'), false),
      'removed', removed)
    from public.cart_items ci join public.ebooks e on e.id = ci.ebook_id where ci.user_id = uid);
end $$;

create or replace function public.cart_add(p_ebook uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); e public.ebooks;
begin
  select * into e from public.ebooks where id = p_ebook and status = 'PUBLISHED' and price_cents is not null;
  if e.id is null then raise exception 'Livre indisponible.' using errcode = 'PT404'; end if;
  if e.seller_id = uid then raise exception 'Vous ne pouvez pas acheter votre propre livre.' using errcode = 'PT409'; end if;
  if e.kind = 'DIGITAL' and p_ebook = any(public.owned_ids(uid)) then
    raise exception 'Cet e-book est déjà dans votre bibliothèque.' using errcode = 'PT409';
  end if;
  if e.kind = 'PHYSICAL' and coalesce(e.stock, 0) = 0 then raise exception 'Ce livre est épuisé.' using errcode = 'PT409'; end if;
  insert into public.cart_items (user_id, ebook_id) values (uid, p_ebook) on conflict do nothing;
  return public.cart_get();
end $$;

create or replace function public.cart_merge(p_ebooks uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  insert into public.cart_items (user_id, ebook_id)
  select uid, e.id from public.ebooks e
  where e.id = any(coalesce(p_ebooks, '{}')) and e.status = 'PUBLISHED' and e.price_cents is not null
    and e.seller_id is distinct from uid
    and not (e.kind = 'DIGITAL' and e.id = any(public.owned_ids(uid)))
    and not (e.kind = 'PHYSICAL' and coalesce(e.stock, 0) = 0)
  on conflict do nothing;
  return public.cart_get();
end $$;

-- ── Adresses de livraison ───────────────────────────────────────

create or replace function public.address_json(a public.shipping_addresses) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'fullName', a.full_name, 'line1', a.line1, 'line2', a.line2, 'city', a.city,
    'postalCode', a.postal_code, 'country', a.country, 'phone', a.phone)
$$;

create or replace function public.my_addresses() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.address_json(a) order by a.created_at desc), '[]') from public.shipping_addresses a where a.user_id = public.current_active_uid()
$$;

create or replace function public.save_address(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); a public.shipping_addresses;
  nm text := trim(coalesce(p->>'fullName', '')); l1 text := trim(coalesce(p->>'line1', '')); city text := trim(coalesce(p->>'city', ''));
  ctry text := upper(trim(coalesce(p->>'country', '')));
begin
  if nm = '' or l1 = '' or city = '' then raise exception 'Nom, adresse et ville sont obligatoires.' using errcode = 'PT400'; end if;
  if ctry !~ '^[A-Z]{2}$' then raise exception 'Pays invalide.' using errcode = 'PT400'; end if;
  if length(nm) > 120 or length(l1) > 200 or length(city) > 100 then raise exception 'Adresse trop longue.' using errcode = 'PT400'; end if;
  if p ? 'id' and p->>'id' is not null then
    update public.shipping_addresses set full_name = nm, line1 = l1, line2 = nullif(trim(p->>'line2'), ''), city = city,
      postal_code = nullif(trim(p->>'postalCode'), ''), country = ctry, phone = nullif(trim(p->>'phone'), '')
    where id = (p->>'id')::uuid and user_id = uid returning * into a;
    if a.id is null then raise exception 'Adresse introuvable.' using errcode = 'PT404'; end if;
  else
    insert into public.shipping_addresses (user_id, full_name, line1, line2, city, postal_code, country, phone)
    values (uid, nm, l1, nullif(trim(p->>'line2'), ''), city, nullif(trim(p->>'postalCode'), ''), ctry, nullif(trim(p->>'phone'), ''))
    returning * into a;
  end if;
  return public.address_json(a);
end $$;

create or replace function public.delete_address(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.shipping_addresses where id = p_id and user_id = public.current_active_uid()
$$;

-- ── Commandes ───────────────────────────────────────────────────

-- Remet en stock les exemplaires physiques d'une commande non payée.
create or replace function public.release_stock(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.ebooks e set stock = e.stock + i.quantity
  from public.order_items i
  where i.order_id = p_order and i.ebook_id = e.id and i.kind = 'PHYSICAL'
    and exists (select 1 from public.orders o where o.id = p_order and o.stock_reserved);
  update public.orders set stock_reserved = false where id = p_order;
end $$;

drop function if exists public.svc_create_order(uuid, uuid[], text, text);
create function public.svc_create_order(p_user uuid, p_ebooks uuid[], p_idem text, p_platform text,
  p_shipping jsonb default '{}', p_address_id uuid default null, p_method text default 'CARD',
  p_mm_country text default null, p_mm_operator text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  existing public.orders; ids uuid[]; n int; bad_title text; curs int; cur text; oid uuid; addr public.shipping_addresses;
  phys int; reserved int; total int; bk record; opt public.ebook_shipping_options;
begin
  if p_idem is not null then
    select * into existing from public.orders where user_id = p_user and idempotency_key = p_idem;
    if existing.id is not null then return jsonb_build_object('orderId', existing.id, 'existing', true); end if;
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'ACTIVE') then
    raise exception 'Compte inactif.' using errcode = '28000';
  end if;
  if p_method not in ('CARD', 'MOBILE_MONEY') then raise exception 'Moyen de paiement inconnu.' using errcode = 'PT400'; end if;
  ids := case when coalesce(array_length(p_ebooks, 1), 0) > 0 then p_ebooks
              else (select array_agg(ebook_id) from public.cart_items where user_id = p_user) end;
  select array_agg(distinct x) into ids from unnest(ids) x;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Votre panier est vide.' using errcode = 'PT400'; end if;

  select count(*), count(distinct currency), min(currency), count(*) filter (where kind = 'PHYSICAL') into n, curs, cur, phys
  from public.ebooks where id = any(ids) and status = 'PUBLISHED' and price_cents is not null;
  if n <> array_length(ids, 1) then raise exception 'Un livre de votre panier n''est plus disponible.' using errcode = 'PT409'; end if;
  if curs > 1 then raise exception 'Les livres d''une même commande doivent avoir la même devise.' using errcode = 'PT400'; end if;
  select title into bad_title from public.ebooks where id = any(ids) and seller_id = p_user limit 1;
  if bad_title is not null then raise exception 'Vous ne pouvez pas acheter votre propre livre (« % »).', bad_title using errcode = 'PT409'; end if;
  select e2.title into bad_title from public.entitlements en join public.ebooks e2 on e2.id = en.ebook_id
  where en.user_id = p_user and en.ebook_id = any(ids) and en.revoked_at is null and e2.kind = 'DIGITAL' limit 1;
  if bad_title is not null then raise exception '« % » est déjà dans votre bibliothèque.', bad_title using errcode = 'PT409'; end if;

  -- Mobile Money : interrupteurs admin vérifiés à la création ; la devise doit être celle du pays.
  if p_method = 'MOBILE_MONEY' then
    if not public.mobile_money_available(p_mm_country, p_mm_operator) then
      raise exception 'Le paiement Mobile Money n''est pas disponible pour cet opérateur.' using errcode = 'PT409';
    end if;
    if cur is distinct from (public.mobile_money_settings() #>> array['countries', p_mm_country, 'currency']) then
      raise exception 'Mobile Money : la commande doit être en %.', public.mobile_money_settings() #>> array['countries', p_mm_country, 'currency'] using errcode = 'PT400';
    end if;
  end if;

  if phys > 0 then
    select * into addr from public.shipping_addresses where id = p_address_id and user_id = p_user;
    if addr.id is null then raise exception 'Choisissez une adresse de livraison.' using errcode = 'PT400'; end if;
  end if;

  total := 0;
  for bk in select * from public.ebooks where id = any(ids) loop
    total := total + bk.price_cents;
    if bk.kind = 'PHYSICAL' then
      select * into opt from public.ebook_shipping_options where id = (p_shipping->>bk.id::text)::uuid and ebook_id = bk.id;
      if opt.id is null then raise exception 'Choisissez un mode de livraison pour « % ».', bk.title using errcode = 'PT400'; end if;
      if cardinality(opt.countries) > 0 and not (addr.country = any(opt.countries)) then
        raise exception '« % » ne peut pas être livré dans ce pays.', bk.title using errcode = 'PT400';
      end if;
      total := total + opt.price_cents;
    end if;
  end loop;

  begin
    insert into public.orders (reference, user_id, total_cents, currency, idempotency_key, platform, payment_method, shipping_address, stock_reserved)
    values ('FO-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)), p_user, total, cur, p_idem, p_platform, p_method,
            case when phys > 0 then public.address_json(addr) end, phys > 0)
    returning id into oid;
  exception when unique_violation then
    select id into oid from public.orders where user_id = p_user and idempotency_key = p_idem;
    return jsonb_build_object('orderId', oid, 'existing', true);
  end;

  insert into public.order_items (order_id, ebook_id, title, price_cents, seller_id, kind, shipping_mode, shipping_cents)
  select oid, e.id, e.title, e.price_cents, e.seller_id, e.kind, s.mode, coalesce(s.price_cents, 0)
  from public.ebooks e left join public.ebook_shipping_options s on e.kind = 'PHYSICAL' and s.id = (p_shipping->>e.id::text)::uuid
  where e.id = any(ids);

  -- Réservation atomique du stock : deux acheteurs ne peuvent pas obtenir le dernier exemplaire.
  if phys > 0 then
    update public.ebooks set stock = stock - 1 where id = any(ids) and kind = 'PHYSICAL' and stock > 0;
    get diagnostics reserved = row_count;
    if reserved < phys then raise exception 'Un livre de votre panier vient d''être épuisé.' using errcode = 'PT409'; end if;
  end if;
  return jsonb_build_object('orderId', oid, 'existing', false);
end $$;

-- L'opérateur n'a pas pu lancer la demande : commande annulée, stock rendu.
create or replace function public.svc_abort_order(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.orders set status = 'CANCELED', canceled_at = now(), updated_at = now() where id = p_order and status = 'PENDING';
  perform public.release_stock(p_order);
end $$;

-- Paiement confirmé : droits (numérique), expéditions (physique), gains des vendeurs. Seul endroit où un accès est créé.
create or replace function public.svc_mark_paid(p_provider text, p_event text, p_session text, p_payment_ref text, p_tax int, p_country text) returns text
language plpgsql security definer set search_path = '' as $$
declare pay public.payments; o public.orders; prev public.order_status; mail text; pct numeric := coalesce((public.app_settings()->>'commissionPercent')::numeric, 0);
  s record;
begin
  select * into pay from public.payments where provider_session_id = p_session;
  if pay.id is null then return 'ignored'; end if;
  update public.payment_events set order_id = pay.order_id where provider = p_provider and provider_event_id = p_event;
  select status into prev from public.orders where id = pay.order_id;
  -- Un paiement confirmé après une annulation automatique reste valable : l'argent a été encaissé.
  update public.orders set status = 'PAID', paid_at = now(), tax_cents = p_tax, tax_country = p_country, updated_at = now()
  where id = pay.order_id and status in ('PENDING', 'CANCELED', 'FAILED') returning * into o;
  if o.id is null then return 'ignored'; end if;
  if prev in ('CANCELED', 'FAILED') and not o.stock_reserved then
    update public.ebooks e set stock = greatest(e.stock - i.quantity, 0) from public.order_items i
    where i.order_id = o.id and i.ebook_id = e.id and i.kind = 'PHYSICAL';
  end if;
  update public.orders set stock_reserved = false where id = o.id;
  update public.payments set status = 'SUCCEEDED', provider_payment_id = coalesce(p_payment_ref, provider_payment_id), updated_at = now() where id = pay.id;

  insert into public.entitlements (user_id, ebook_id, order_id)
  select o.user_id, i.ebook_id, o.id from public.order_items i where i.order_id = o.id and i.kind = 'DIGITAL'
  on conflict (user_id, ebook_id) do update set revoked_at = null, order_id = excluded.order_id, granted_at = now();

  insert into public.shipments (order_id, seller_id, buyer_id, address)
  select distinct o.id, i.seller_id, o.user_id, o.shipping_address from public.order_items i where i.order_id = o.id and i.kind = 'PHYSICAL'
  on conflict do nothing;

  -- Gains disponibles immédiatement (décision du propriétaire) ; commission sur le prix seul, livraison au vendeur.
  insert into public.seller_earnings (seller_id, order_item_id, currency, gross_cents, commission_cents, net_cents)
  select i.seller_id, i.id, o.currency, i.price_cents + i.shipping_cents, round(i.price_cents * pct / 100)::int,
         i.price_cents + i.shipping_cents - round(i.price_cents * pct / 100)::int
  from public.order_items i where i.order_id = o.id and i.seller_id is not null
  on conflict do nothing;

  delete from public.cart_items ci using public.order_items i where i.order_id = o.id and ci.user_id = o.user_id and ci.ebook_id = i.ebook_id;
  select email into mail from public.profiles where id = o.user_id;
  perform public.queue_email(mail, 'order_confirmed', format('Commande %s confirmée', o.reference),
    format(E'Merci pour votre achat !\n\nCommande %s — %s\n%s\n\nLes livres numériques sont dans votre bibliothèque ; les livres physiques vous seront expédiés par leur vendeur.',
      o.reference, public.money(o.total_cents, o.currency), (select string_agg('• ' || title, E'\n') from public.order_items where order_id = o.id)));
  for s in select i.seller_id, string_agg('• ' || i.title, E'\n') titles, bool_or(i.kind = 'PHYSICAL') physical
           from public.order_items i where i.order_id = o.id and i.seller_id is not null group by i.seller_id loop
    perform public.queue_email((select email from public.profiles where id = s.seller_id), 'seller_sale', format('Vente — commande %s', o.reference),
      format(E'Bonne nouvelle, vous avez vendu :\n%s\n\n%s', s.titles,
        case when s.physical then 'Expédiez le livre depuis votre espace vendeur et indiquez-le comme expédié.' else 'Vos gains sont disponibles dans votre espace vendeur.' end));
  end loop;
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
  perform public.release_stock(o.id);
  update public.payments set status = 'FAILED', failure_reason = p_reason, updated_at = now() where id = pay.id;
  select email into mail from public.profiles where id = o.user_id;
  perform public.queue_email(mail, 'payment_failed', format('Paiement non abouti — commande %s', o.reference),
    format(E'Bonjour,\n\nLe paiement de la commande %s n''a pas abouti. Aucun montant n''a été débité et votre panier est conservé. Vous pouvez réessayer depuis l''application.', o.reference));
  return 'applied';
end $$;

create or replace function public.cancel_stale_orders(p_minutes int default 60) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; oid uuid;
begin
  for oid in update public.orders set status = 'CANCELED', canceled_at = now(), updated_at = now()
             where status = 'PENDING' and created_at < now() - make_interval(mins => p_minutes) returning id loop
    perform public.release_stock(oid);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Remboursement : accès retiré, expéditions annulées ; gains annulés, ou dette si déjà versés.
create or replace function public.svc_mark_refunded(p_order uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.orders; mail text;
begin
  update public.orders set status = 'REFUNDED', refunded_at = now(), updated_at = now() where id = p_order and status = 'PAID' returning * into o;
  if o.id is null then return 'ignored'; end if;
  update public.payments set status = 'REFUNDED', updated_at = now() where order_id = o.id and status = 'SUCCEEDED';
  update public.entitlements set revoked_at = now() where order_id = o.id and revoked_at is null;
  update public.shipments set status = 'CANCELED' where order_id = o.id and status = 'TO_SHIP';
  update public.seller_earnings se set status = 'REVERSED'
  from public.order_items i where i.order_id = o.id and se.order_item_id = i.id and se.reason = 'SALE' and se.status = 'AVAILABLE' and se.payout_id is null;
  insert into public.seller_earnings (seller_id, order_item_id, reason, currency, gross_cents, commission_cents, net_cents)
  select se.seller_id, se.order_item_id, 'REFUND', se.currency, -se.gross_cents, -se.commission_cents, -se.net_cents
  from public.seller_earnings se join public.order_items i on i.id = se.order_item_id
  where i.order_id = o.id and se.reason = 'SALE' and (se.status = 'PAID_OUT' or se.payout_id is not null)
  on conflict do nothing;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (p_actor, 'order.refund', 'order', o.id::text, jsonb_build_object('reference', o.reference));
  select email into mail from public.profiles where id = o.user_id;
  perform public.queue_email(mail, 'order_refunded', format('Commande %s remboursée', o.reference),
    format(E'Bonjour,\n\nLa commande %s a été remboursée. Les livres numériques concernés ne sont plus accessibles dans votre bibliothèque.', o.reference));
  return 'applied';
end $$;

create or replace function public.order_json(o public.orders) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'reference', o.reference, 'status', o.status, 'totalCents', o.total_cents, 'currency', o.currency,
    'taxCents', o.tax_cents, 'createdAt', o.created_at, 'paidAt', o.paid_at, 'paymentMethod', o.payment_method,
    'shippingAddress', o.shipping_address,
    'items', coalesce((select jsonb_agg(jsonb_build_object('ebookId', i.ebook_id, 'title', i.title, 'priceCents', i.price_cents, 'kind', i.kind,
        'quantity', i.quantity, 'shippingMode', i.shipping_mode, 'shippingCents', i.shipping_cents,
        'seller', (select jsonb_build_object('id', p.id, 'name', p.name) from public.profiles p where p.id = i.seller_id))) from public.order_items i where i.order_id = o.id), '[]'),
    'shipments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'tracking', s.tracking, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at,
        'seller', (select jsonb_build_object('id', p.id, 'name', p.name) from public.profiles p where p.id = s.seller_id))) from public.shipments s where s.order_id = o.id), '[]'))
$$;

-- Achats physiques de l'acheteur, avec suivi.
create or replace function public.my_physical_orders() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.order_json(o) order by o.created_at desc), '[]') from public.orders o
  where o.user_id = public.current_active_uid() and o.status in ('PAID', 'REFUNDED')
    and exists (select 1 from public.order_items i where i.order_id = o.id and i.kind = 'PHYSICAL')
$$;

create or replace function public.confirm_delivery(p_shipment uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); s public.shipments;
begin
  update public.shipments set status = 'DELIVERED', delivered_at = now()
  where id = p_shipment and buyer_id = uid and status in ('TO_SHIP', 'SHIPPED') returning * into s;
  if s.id is null then raise exception 'Expédition introuvable.' using errcode = 'PT404'; end if;
  return public.my_order(s.order_id);
end $$;

-- ── Espace vendeur ──────────────────────────────────────────────

-- Création / modification commune à l'admin (p_seller null = livre de la plateforme) et au vendeur.
create or replace function public.save_book(p_id uuid, p jsonb, p_seller uuid, p_admin boolean) returns public.ebooks
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; cat uuid; old_price int; k text := upper(p->>'kind'); sold boolean;
begin
  if p ? 'category' then
    if coalesce(trim(p->>'category'), '') = '' then cat := null;
    else
      insert into public.categories (name, slug, sort) values (left(trim(p->>'category'), 60), public.slugify(p->>'category'), (select count(*) from public.categories))
      on conflict (name) do update set name = excluded.name returning id into cat;
    end if;
  end if;
  if p ? 'currency' and upper(p->>'currency') not in ('EUR', 'KMF', 'MGA') then raise exception 'Devise : EUR, KMF ou MGA.' using errcode = 'PT400'; end if;
  if p ? 'priceCents' and p->>'priceCents' is not null and (p->>'priceCents')::int < 0 then raise exception 'Le prix ne peut pas être négatif.' using errcode = 'PT400'; end if;
  if p ? 'condition' and p->>'condition' is not null and p->>'condition' not in ('NEW', 'VERY_GOOD', 'GOOD', 'WORN') then raise exception 'État du livre invalide.' using errcode = 'PT400'; end if;
  if p ? 'stock' and p->>'stock' is not null and (p->>'stock')::int < 0 then raise exception 'Le stock ne peut pas être négatif.' using errcode = 'PT400'; end if;
  if k is not null and k not in ('PHYSICAL', 'DIGITAL') then raise exception 'Choisissez « Livre physique » ou « Livre numérique ».' using errcode = 'PT400'; end if;

  if p_id is null then
    if coalesce(trim(p->>'title'), '') = '' or coalesce(trim(p->>'author'), '') = '' then raise exception 'Le titre et l''auteur sont obligatoires.' using errcode = 'PT400'; end if;
    if k is null and not p_admin then raise exception 'Choisissez « Livre physique » ou « Livre numérique ».' using errcode = 'PT400'; end if;
    -- Livre numérique d'un vendeur : téléchargeable par ses acheteurs (PDF ou EPUB).
    insert into public.ebooks (slug, title, author, seller_id, kind, download_allowed)
    values ('', left(trim(p->>'title'), 200), left(trim(p->>'author'), 120), p_seller, coalesce(k, 'DIGITAL')::public.product_kind, p_seller is not null and coalesce(k, 'DIGITAL') = 'DIGITAL') returning * into e;
    e.slug := public.slugify(e.title);
    if e.slug = '' or exists (select 1 from public.ebooks where slug = e.slug and id <> e.id) then e.slug := e.slug || '-' || substr(e.id::text, 1, 6); end if;
    update public.ebooks set slug = e.slug where id = e.id;
    perform public.audit('ebook.create', 'ebook', e.id::text, jsonb_build_object('title', e.title, 'seller', p_seller));
  else
    select * into e from public.ebooks where id = p_id;
    if e.id is null or (not p_admin and e.seller_id is distinct from p_seller) then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
    sold := exists (select 1 from public.order_items where ebook_id = e.id);
    if k is not null and k <> e.kind::text and sold then raise exception 'Le type ne peut plus changer : ce livre a déjà été vendu.' using errcode = 'PT409'; end if;
  end if;
  old_price := e.price_cents;
  update public.ebooks set
    title = coalesce(left(nullif(trim(p->>'title'), ''), 200), title),
    author = coalesce(left(nullif(trim(p->>'author'), ''), 120), author),
    description = coalesce(left(p->>'description', 10000), description),
    category_id = case when p ? 'category' then cat else category_id end,
    price_cents = case when p ? 'priceCents' then (p->>'priceCents')::int else price_cents end,
    currency = coalesce(upper(p->>'currency'), currency),
    language = coalesce(nullif(lower(trim(p->>'language')), ''), language),
    kind = coalesce(k, kind::text)::public.product_kind,
    condition = case when coalesce(k, kind::text) = 'DIGITAL' then null when p ? 'condition' then (p->>'condition')::public.book_condition else condition end,
    stock = case when coalesce(k, kind::text) = 'DIGITAL' then null when p ? 'stock' then (p->>'stock')::int else stock end,
    format = case when p ? 'format' then nullif(trim(p->>'format'), '') else format end,
    pages = case when p ? 'pages' then (p->>'pages')::int else pages end,
    download_allowed = case when coalesce(k, kind::text) = 'PHYSICAL' then false else coalesce((p->>'downloadAllowed')::boolean, download_allowed) end,
    preview_blocks = coalesce((p->>'previewBlocks')::int, preview_blocks),
    featured = case when p_admin then coalesce((p->>'featured')::boolean, featured) else featured end,
    cover_bg = coalesce(p->>'coverBg', cover_bg), cover_fg = coalesce(p->>'coverFg', cover_fg), cover_tint = coalesce(p->>'coverTint', cover_tint)
  where id = e.id returning * into e;
  if coalesce(k, e.kind::text) = 'DIGITAL' then delete from public.ebook_shipping_options where ebook_id = e.id; end if;
  if p_id is not null and e.price_cents is distinct from old_price then
    perform public.audit('ebook.price', 'ebook', e.id::text, jsonb_build_object('from', old_price, 'to', e.price_cents));
  end if;
  return e;
end $$;

create or replace function public.admin_save_ebook(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks;
begin
  perform public.require_admin();
  e := public.save_book(p_id, p, null, true);
  return public.admin_ebook_json(e);
end $$;

create or replace function public.admin_set_ebook_status(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; problems text[];
begin
  perform public.require_admin();
  select * into e from public.ebooks where id = p_id;
  if e.id is null then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
  if p_action = 'publish' then
    problems := public.book_problems(e);
    if cardinality(problems) > 0 then raise exception 'Publication impossible : %.', array_to_string(problems, ', ') using errcode = 'PT400'; end if;
    update public.ebooks set status = 'PUBLISHED', published_at = coalesce(published_at, now()) where id = p_id returning * into e;
  elsif p_action = 'unpublish' then
    update public.ebooks set status = 'DRAFT' where id = p_id returning * into e;
  elsif p_action = 'archive' then
    update public.ebooks set status = 'ARCHIVED', featured = false where id = p_id returning * into e;
  else
    raise exception 'Action inconnue.' using errcode = 'PT400';
  end if;
  perform public.audit('ebook.' || p_action, 'ebook', p_id::text, jsonb_build_object('title', e.title, 'seller', e.seller_id));
  return public.admin_ebook_json(e);
end $$;

create or replace function public.admin_ebooks(p_q text default null, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare words text[] := case when coalesce(trim(p_q), '') = '' then '{}' else regexp_split_to_array(public.norm(trim(p_q)), '\s+') end;
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(public.admin_ebook_json(e) order by e.updated_at desc) from public.ebooks e
    where (p_status is null or p_status = '' or e.status::text = p_status)
      and (select bool_and(e.search_text like '%' || w || '%') from unnest(words) w) is not false), '[]');
end $$;

create or replace function public.seller_ebooks() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.admin_ebook_json(e) order by e.updated_at desc), '[]') from public.ebooks e
  where e.seller_id = public.current_active_uid() and e.status <> 'ARCHIVED'
$$;

create or replace function public.seller_ebook(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.ebooks;
begin
  select * into e from public.ebooks where id = p_id and seller_id = public.current_active_uid();
  if e.id is null then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
  return public.admin_ebook_json(e);
end $$;

create or replace function public.seller_save_ebook(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); e public.ebooks;
begin
  e := public.save_book(p_id, p, uid, false);
  return public.admin_ebook_json(e);
end $$;

-- Mettre en vente, mettre en pause, retirer.
create or replace function public.seller_set_status(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); e public.ebooks; problems text[];
begin
  select * into e from public.ebooks where id = p_id and seller_id = uid;
  if e.id is null then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
  if p_action = 'publish' then
    problems := public.book_problems(e);
    if cardinality(problems) > 0 then raise exception 'Mise en vente impossible : %.', array_to_string(problems, ', ') using errcode = 'PT400'; end if;
    update public.ebooks set status = 'PUBLISHED', published_at = coalesce(published_at, now()) where id = p_id returning * into e;
  elsif p_action = 'pause' then
    if e.status <> 'PUBLISHED' then raise exception 'Seule une annonce en vente peut être mise en pause.' using errcode = 'PT409'; end if;
    update public.ebooks set status = 'PAUSED' where id = p_id returning * into e;
  elsif p_action = 'archive' then
    update public.ebooks set status = 'ARCHIVED', featured = false where id = p_id returning * into e;
  else
    raise exception 'Action inconnue.' using errcode = 'PT400';
  end if;
  return public.admin_ebook_json(e);
end $$;

-- Suppression définitive : annonce jamais vendue ; renvoie les fichiers à effacer du stockage.
create or replace function public.seller_delete_ebook(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); e public.ebooks; paths jsonb;
begin
  select * into e from public.ebooks where id = p_id and seller_id = uid;
  if e.id is null then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
  if exists (select 1 from public.order_items where ebook_id = p_id) then
    raise exception 'Ce livre a déjà été vendu : retirez-le de la vente plutôt que de le supprimer.' using errcode = 'PT409';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('path', storage_path, 'kind', kind)), '[]') into paths from public.ebook_files where ebook_id = p_id;
  delete from public.ebooks where id = p_id;
  return paths;
end $$;

-- Modes de livraison d'un livre physique (remplace la liste).
create or replace function public.set_shipping_options(p_id uuid, p jsonb, p_seller uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; o jsonb;
begin
  select * into e from public.ebooks where id = p_id;
  if e.id is null or (not p_admin and e.seller_id is distinct from p_seller) then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
  if e.kind <> 'PHYSICAL' then raise exception 'La livraison ne concerne que les livres physiques.' using errcode = 'PT400'; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 or jsonb_array_length(p) > 3 then
    raise exception 'Indiquez entre 1 et 3 modes de livraison.' using errcode = 'PT400';
  end if;
  delete from public.ebook_shipping_options where ebook_id = p_id;
  for o in select * from jsonb_array_elements(p) loop
    if o->>'mode' not in ('HAND', 'POST', 'COURIER') then raise exception 'Mode de livraison inconnu.' using errcode = 'PT400'; end if;
    if coalesce((o->>'priceCents')::int, 0) < 0 then raise exception 'Frais de livraison invalides.' using errcode = 'PT400'; end if;
    insert into public.ebook_shipping_options (ebook_id, mode, price_cents, countries, delay_days)
    values (p_id, (o->>'mode')::public.shipping_mode, coalesce((o->>'priceCents')::int, 0),
            coalesce((select array_agg(upper(c)) from jsonb_array_elements_text(coalesce(o->'countries', '[]')) c where upper(c) ~ '^[A-Z]{2}$'), '{}'),
            (o->>'delayDays')::int);
  end loop;
end $$;

create or replace function public.seller_set_shipping(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  perform public.set_shipping_options(p_id, p, uid, false);
  return public.seller_ebook(p_id);
end $$;

create or replace function public.admin_set_shipping(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  perform public.set_shipping_options(p_id, p, null, true);
  return public.admin_ebook((p_id));
end $$;

create or replace function public.seller_dashboard() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select public.current_active_uid() uid)
  select jsonb_build_object(
    'listings', jsonb_build_object(
      'onSale', (select count(*) from public.ebooks, me where seller_id = me.uid and status = 'PUBLISHED'),
      'paused', (select count(*) from public.ebooks, me where seller_id = me.uid and status = 'PAUSED'),
      'drafts', (select count(*) from public.ebooks, me where seller_id = me.uid and status = 'DRAFT')),
    'sold', (select coalesce(sum(i.quantity), 0) from public.order_items i join public.orders o on o.id = i.order_id, me where i.seller_id = me.uid and o.status = 'PAID'),
    'toShip', (select count(*) from public.shipments s, me where s.seller_id = me.uid and s.status = 'TO_SHIP'),
    'earnings', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'availableCents', available, 'paidOutCents', paid, 'totalCents', total) order by currency) from (
        select currency,
          coalesce(sum(net_cents) filter (where status = 'AVAILABLE' and payout_id is null), 0) available,
          coalesce(sum(net_cents) filter (where status = 'PAID_OUT'), 0) paid,
          coalesce(sum(net_cents) filter (where status <> 'REVERSED'), 0) total
        from public.seller_earnings, me where seller_id = me.uid group by currency) x), '[]'),
    'recentSales', coalesce((select jsonb_agg(r order by r->>'date' desc) from (
        select jsonb_build_object('title', i.title, 'kind', i.kind, 'date', o.paid_at, 'reference', o.reference, 'currency', o.currency,
          'netCents', (select se.net_cents from public.seller_earnings se where se.order_item_id = i.id and se.reason = 'SALE'),
          'status', o.status) r
        from public.order_items i join public.orders o on o.id = i.order_id, me
        where i.seller_id = me.uid and o.status in ('PAID', 'REFUNDED') order by o.paid_at desc limit 20) x), '[]'),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'currency', p.currency, 'amountCents', p.amount_cents,
        'status', p.status, 'paidAt', p.paid_at, 'createdAt', p.created_at) order by p.created_at desc) from public.payouts p, me where p.seller_id = me.uid), '[]'))
$$;

-- Expéditions à préparer : l'adresse de l'acheteur n'est visible que du vendeur concerné.
create or replace function public.seller_shipments() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'address', s.address, 'tracking', s.tracking,
      'createdAt', s.created_at, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at, 'reference', o.reference,
      'items', (select jsonb_agg(jsonb_build_object('title', i.title, 'shippingMode', i.shipping_mode)) from public.order_items i
                where i.order_id = s.order_id and i.seller_id = s.seller_id and i.kind = 'PHYSICAL'))
    order by (s.status = 'TO_SHIP') desc, s.created_at desc), '[]')
  from public.shipments s join public.orders o on o.id = s.order_id
  where s.seller_id = public.current_active_uid()
$$;

create or replace function public.seller_mark_shipped(p_shipment uuid, p_tracking text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.shipments;
begin
  update public.shipments set status = 'SHIPPED', shipped_at = now(), tracking = left(nullif(trim(p_tracking), ''), 100)
  where id = p_shipment and seller_id = public.current_active_uid() and status = 'TO_SHIP' returning * into s;
  if s.id is null then raise exception 'Expédition introuvable ou déjà expédiée.' using errcode = 'PT404'; end if;
  perform public.queue_email((select email from public.profiles where id = s.buyer_id), 'order_shipped', 'Votre livre a été expédié',
    format(E'Bonjour,\n\nVotre commande %s a été expédiée.%s', (select reference from public.orders where id = s.order_id),
      case when s.tracking is null then '' else E'\nSuivi : ' || s.tracking end));
  return public.seller_shipments();
end $$;

-- Coordonnées de paiement : jamais renvoyées en clair (seulement les 4 derniers caractères).
create or replace function public.my_payout_accounts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'country', a.country, 'operator', a.operator,
      'holderName', a.holder_name, 'bankName', a.bank_name, 'masked', '****' || a.last4, 'isDefault', a.is_default, 'createdAt', a.created_at)
    order by a.is_default desc, a.created_at), '[]')
  from public.seller_payout_accounts a where a.user_id = public.current_active_uid()
$$;

create or replace function public.delete_payout_account(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid(); was_default boolean;
begin
  delete from public.seller_payout_accounts where id = p_id and user_id = uid returning is_default into was_default;
  if was_default then
    update public.seller_payout_accounts set is_default = true
    where id = (select id from public.seller_payout_accounts where user_id = uid order by created_at limit 1);
  end if;
  return public.my_payout_accounts();
end $$;

create or replace function public.set_default_payout_account(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  if not exists (select 1 from public.seller_payout_accounts where id = p_id and user_id = uid) then
    raise exception 'Compte introuvable.' using errcode = 'PT404';
  end if;
  update public.seller_payout_accounts set is_default = false where user_id = uid and is_default;
  update public.seller_payout_accounts set is_default = true where id = p_id;
  return public.my_payout_accounts();
end $$;

-- ── Reversements ────────────────────────────────────────────────

-- Sommes dues par vendeur et par devise (gains disponibles, dettes déduites).
create or replace function public.admin_payouts_due() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('sellerId', x.seller_id, 'currency', x.currency, 'amountCents', x.amount, 'lines', x.lines,
      'seller', jsonb_build_object('name', p.name, 'email', p.email),
      'account', (select jsonb_build_object('id', a.id, 'kind', a.kind, 'country', a.country, 'operator', a.operator, 'holderName', a.holder_name,
          'bankName', a.bank_name, 'masked', '****' || a.last4) from public.seller_payout_accounts a where a.user_id = x.seller_id and a.is_default))
    order by x.amount desc)
    from (select seller_id, currency, sum(net_cents) amount, count(*) lines from public.seller_earnings
          where status = 'AVAILABLE' and payout_id is null group by seller_id, currency having sum(net_cents) > 0) x
    join public.profiles p on p.id = x.seller_id), '[]');
end $$;

-- Virement bancaire effectué par l'admin depuis sa banque.
create or replace function public.admin_mark_bank_payout(p_seller uuid, p_currency text, p_reference text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare admin uuid := public.require_admin(); amount int; acc public.seller_payout_accounts; pid uuid;
begin
  select coalesce(sum(net_cents), 0) into amount from public.seller_earnings
  where seller_id = p_seller and currency = p_currency and status = 'AVAILABLE' and payout_id is null;
  if amount <= 0 then raise exception 'Aucune somme à verser.' using errcode = 'PT409'; end if;
  select * into acc from public.seller_payout_accounts where user_id = p_seller and kind = 'BANK' order by is_default desc, created_at limit 1;
  if acc.id is null then raise exception 'Ce vendeur n''a pas enregistré de compte bancaire.' using errcode = 'PT409'; end if;
  insert into public.payouts (seller_id, account_id, method, currency, amount_cents, status, reference, created_by, paid_at)
  values (p_seller, acc.id, 'BANK', p_currency, amount, 'PAID', left(nullif(trim(p_reference), ''), 100), admin, now()) returning id into pid;
  update public.seller_earnings set status = 'PAID_OUT', payout_id = pid
  where seller_id = p_seller and currency = p_currency and status = 'AVAILABLE' and payout_id is null;
  perform public.audit('payout.bank', 'payout', pid::text, jsonb_build_object('seller', p_seller, 'currency', p_currency, 'amountCents', amount));
  return public.admin_payouts_due();
end $$;

create or replace function public.admin_payouts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'currency', p.currency, 'amountCents', p.amount_cents,
      'status', p.status, 'reference', p.reference, 'providerRef', p.provider_ref, 'failureReason', p.failure_reason, 'paidAt', p.paid_at, 'createdAt', p.created_at,
      'seller', jsonb_build_object('name', s.name, 'email', s.email)) order by p.created_at desc)
    from (select * from public.payouts order by created_at desc limit 200) p join public.profiles s on s.id = p.seller_id), '[]');
end $$;

-- Mobile Money : prépare les versements automatiques (appelé par la fonction Edge « payouts »).
create or replace function public.svc_prepare_mobile_money_payouts() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; pid uuid; out jsonb := '[]';
begin
  if not coalesce((public.mobile_money_settings()->>'payoutsEnabled')::boolean, false) then return out; end if;
  for r in select se.seller_id, se.currency, sum(se.net_cents) amount, a.id account_id, a.country, a.operator, a.secret_ciphertext
           from public.seller_earnings se
           join public.seller_payout_accounts a on a.user_id = se.seller_id and a.is_default and a.kind = 'MOBILE_MONEY'
           where se.status = 'AVAILABLE' and se.payout_id is null
             and se.currency = (public.mobile_money_settings() #>> array['countries', a.country, 'currency'])
           group by se.seller_id, se.currency, a.id, a.country, a.operator, a.secret_ciphertext
           having sum(se.net_cents) > 0 loop
    insert into public.payouts (seller_id, account_id, method, currency, amount_cents) values (r.seller_id, r.account_id, 'MOBILE_MONEY', r.currency, r.amount) returning id into pid;
    update public.seller_earnings set payout_id = pid where seller_id = r.seller_id and currency = r.currency and status = 'AVAILABLE' and payout_id is null;
    out := out || jsonb_build_object('payoutId', pid, 'amountCents', r.amount, 'currency', r.currency, 'country', r.country, 'operator', r.operator, 'ciphertext', r.secret_ciphertext);
  end loop;
  return out;
end $$;

create or replace function public.svc_complete_payout(p_payout uuid, p_ok boolean, p_ref text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.payouts set status = 'PAID', provider_ref = p_ref, paid_at = now() where id = p_payout and status = 'PROCESSING';
    update public.seller_earnings set status = 'PAID_OUT' where payout_id = p_payout and status = 'AVAILABLE';
  else
    update public.payouts set status = 'FAILED', failure_reason = left(p_reason, 300) where id = p_payout and status = 'PROCESSING';
    update public.seller_earnings set payout_id = null where payout_id = p_payout and status = 'AVAILABLE';
  end if;
end $$;

-- ── Droits d'exécution ──────────────────────────────────────────

revoke execute on function
  public.mobile_money_defaults(), public.mobile_money_settings(), public.mobile_money_available(text, text), public.jsonb_deep_merge(jsonb, jsonb),
  public.book_problems(public.ebooks), public.address_json(public.shipping_addresses), public.release_stock(uuid),
  public.svc_create_order(uuid, uuid[], text, text, jsonb, uuid, text, text, text), public.svc_abort_order(uuid), public.save_book(uuid, jsonb, uuid, boolean),
  public.set_shipping_options(uuid, jsonb, uuid, boolean), public.svc_prepare_mobile_money_payouts(), public.svc_complete_payout(uuid, boolean, text, text),
  public.search_ebooks(text, text, text, int, int, text), public.admin_get_mobile_money(), public.admin_set_mobile_money(jsonb), public.admin_mobile_money_log(),
  public.my_addresses(), public.save_address(jsonb), public.delete_address(uuid), public.my_physical_orders(), public.confirm_delivery(uuid),
  public.seller_ebooks(), public.seller_ebook(uuid), public.seller_save_ebook(uuid, jsonb), public.seller_set_status(uuid, text), public.seller_delete_ebook(uuid),
  public.seller_set_shipping(uuid, jsonb), public.admin_set_shipping(uuid, jsonb), public.seller_dashboard(), public.seller_shipments(),
  public.seller_mark_shipped(uuid, text), public.my_payout_accounts(), public.delete_payout_account(uuid), public.set_default_payout_account(uuid),
  public.admin_payouts_due(), public.admin_mark_bank_payout(uuid, text, text), public.admin_payouts()
from public, anon, authenticated;

grant execute on function public.search_ebooks(text, text, text, int, int, text) to anon, authenticated;
grant execute on function
  public.admin_get_mobile_money(), public.admin_set_mobile_money(jsonb), public.admin_mobile_money_log(),
  public.my_addresses(), public.save_address(jsonb), public.delete_address(uuid), public.my_physical_orders(), public.confirm_delivery(uuid),
  public.seller_ebooks(), public.seller_ebook(uuid), public.seller_save_ebook(uuid, jsonb), public.seller_set_status(uuid, text), public.seller_delete_ebook(uuid),
  public.seller_set_shipping(uuid, jsonb), public.admin_set_shipping(uuid, jsonb), public.seller_dashboard(), public.seller_shipments(),
  public.seller_mark_shipped(uuid, text), public.my_payout_accounts(), public.delete_payout_account(uuid), public.set_default_payout_account(uuid),
  public.admin_payouts_due(), public.admin_mark_bank_payout(uuid, text, text), public.admin_payouts()
to authenticated;
grant execute on all functions in schema public to service_role;
