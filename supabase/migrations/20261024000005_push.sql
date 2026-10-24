-- Notifications sur le téléphone (Expo Push) : jetons des appareils, et suivi de l'envoi
-- à côté de chaque e-mail transactionnel (la fonction « send-emails » envoie les deux).

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique check (token ~ '^(Exponent|Expo)PushToken\[.+\]$'),
  platform text check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
-- Aucune lecture directe : enregistrement par register_push_token, envoi par le service.

alter table public.email_outbox add column push_sent_at timestamptz;
-- Les e-mails antérieurs ne déclenchent pas de notification rétroactive.
update public.email_outbox set push_sent_at = coalesce(sent_at, created_at);

create or replace function public.register_push_token(p_token text, p_platform text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.current_active_uid();
begin
  if p_token !~ '^(Exponent|Expo)PushToken\[.+\]$' then raise exception 'Jeton de notification invalide.' using errcode = 'PT400'; end if;
  insert into public.push_tokens (user_id, token, platform) values (uid, p_token, nullif(p_platform, ''))
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end $$;

create or replace function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid()
$$;

revoke execute on function public.register_push_token(text, text), public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text), public.unregister_push_token(text) to authenticated;
