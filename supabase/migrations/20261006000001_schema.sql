-- Folio sur Supabase — schéma, voir docs/03b-supabase.md
-- Règle absolue : orders, payments, entitlements ne sont écrits que par les Edge Functions
-- (clé service_role), jamais par un client. Aucune policy d'écriture n'existe pour eux.

create extension if not exists unaccent with schema extensions;

create type public.app_role as enum ('CUSTOMER', 'ADMIN');
create type public.user_status as enum ('ACTIVE', 'SUSPENDED', 'DELETED');
create type public.ebook_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
create type public.file_kind as enum ('COVER', 'MAIN', 'CONTENT');
create type public.order_status as enum ('PENDING', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED');
create type public.payment_status as enum ('CREATED', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- Recherche insensible aux accents.
create or replace function public.norm(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

-- ── Comptes ─────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text not null default '',
  role public.app_role not null default 'CUSTOMER',
  status public.user_status not null default 'ACTIVE',
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.profiles (lower(email));

create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  ebook_updates boolean not null default true,
  marketing boolean not null default false
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_key text not null,
  label text not null,
  platform text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, device_key)
);

-- ── Catalogue ───────────────────────────────────────────────────

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  sort int not null default 0
);

create table public.ebooks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  author text not null,
  description text not null default '',
  category_id uuid references public.categories (id),
  price_cents int check (price_cents is null or price_cents >= 0),
  currency text not null default 'EUR',
  format text,
  pages int,
  status public.ebook_status not null default 'DRAFT',
  download_allowed boolean not null default false,
  preview_blocks int not null default 12 check (preview_blocks between 0 and 500),
  featured boolean not null default false,
  cover_bg text not null default '#14151F',
  cover_fg text not null default '#D7F25C',
  cover_tint text not null default '#ECEBE6',
  search_text text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ebooks (status, published_at desc);

-- Fichiers : COVER dans le bucket public « covers » ; MAIN et CONTENT dans le bucket privé « ebooks ».
create table public.ebook_files (
  id uuid primary key default gen_random_uuid(),
  ebook_id uuid not null references public.ebooks (id) on delete cascade,
  kind public.file_kind not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes int not null default 0,
  original_name text not null default '',
  created_at timestamptz not null default now()
);
create index on public.ebook_files (ebook_id, kind);

create table public.ebook_views (
  id bigint generated always as identity primary key,
  ebook_id uuid not null references public.ebooks (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.ebook_views (ebook_id, created_at);

-- ── Achat ───────────────────────────────────────────────────────

create table public.cart_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ebook_id uuid not null references public.ebooks (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, ebook_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid not null references public.profiles (id),
  status public.order_status not null default 'PENDING',
  total_cents int not null,
  currency text not null,
  tax_cents int,
  tax_country text,
  idempotency_key text,
  platform text,
  paid_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index on public.orders (status, created_at);
create index on public.orders (user_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  ebook_id uuid not null references public.ebooks (id),
  title text not null,
  price_cents int not null,
  unique (order_id, ebook_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null,
  provider_session_id text not null unique,
  provider_payment_id text,
  status public.payment_status not null default 'CREATED',
  amount_cents int not null,
  currency text not null,
  failure_reason text,
  return_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  type text not null,
  outcome text not null,
  order_id uuid references public.orders (id) on delete set null,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  ebook_id uuid not null references public.ebooks (id),
  order_id uuid references public.orders (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, ebook_id)
);

-- ── Lecture ─────────────────────────────────────────────────────

create table public.download_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id),
  ebook_id uuid not null references public.ebooks (id),
  kind text not null check (kind in ('read', 'download')),
  created_at timestamptz not null default now()
);
create index on public.download_events (user_id, ebook_id, kind);

create table public.reading_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ebook_id uuid not null references public.ebooks (id) on delete cascade,
  chapter_index int not null default 0,
  block_index int not null default 0,
  percent int not null default 0 check (percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, ebook_id)
);

-- ── Exploitation ────────────────────────────────────────────────

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  target_type text,
  target_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (created_at desc);

-- E-mails transactionnels : écrits en base, envoyés par la fonction « send-emails ».
create table public.email_outbox (
  id bigint generated always as identity primary key,
  to_email text not null,
  kind text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);
create index on public.email_outbox (sent_at) where sent_at is null;
