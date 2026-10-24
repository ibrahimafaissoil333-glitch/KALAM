-- Nom de l'application dans l'e-mail de bienvenue : Kalam (au lieu de l'ancien nom).

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform public.queue_email(lower(new.email), 'account_created', 'Bienvenue sur Kalam',
    format(E'Bonjour %s,\n\nVotre compte Kalam est créé. Vos achats seront disponibles dans votre bibliothèque, sur tous vos appareils.\n\nÀ bientôt,\nL''équipe Kalam', nm));
  return new;
end $function$
;

