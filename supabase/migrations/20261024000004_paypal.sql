-- PayPal : troisième moyen de paiement (commandes en euros), activable par l'admin dans les Paramètres.

alter table public.orders drop constraint orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (payment_method in ('CARD', 'MOBILE_MONEY', 'PAYPAL'));

CREATE OR REPLACE FUNCTION public.app_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'appName', 'Kalam',
    'checkoutMode', jsonb_build_object('ios', 'external', 'android', 'external'),
    'webCheckoutUrl', null, 'maxDevices', null, 'maxDownloadsPerBook', null, 'supportEmail', null,
    'termsUrl', null, 'salesTermsUrl', null, 'privacyUrl', null, 'legalNoticeUrl', null,
    'commissionPercent', 2, 'paypalEnabled', false
  ) || coalesce((select value from public.settings where key = 'app'), '{}'::jsonb)
$function$;

CREATE OR REPLACE FUNCTION public.admin_put_settings(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare allowed text[] := array['appName','checkoutMode','webCheckoutUrl','maxDevices','maxDownloadsPerBook','supportEmail','termsUrl','salesTermsUrl','privacyUrl','legalNoticeUrl','commissionPercent','paypalEnabled'];
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
  if clean ? 'paypalEnabled' and jsonb_typeof(clean->'paypalEnabled') <> 'boolean' then
    raise exception 'paypalEnabled : vrai ou faux.' using errcode = 'PT400';
  end if;
  insert into public.settings (key, value) values ('app', clean)
  on conflict (key) do update set value = public.settings.value || excluded.value, updated_at = now();
  perform public.audit('settings.update', 'settings', 'app', clean);
  return public.app_settings();
end $function$;

CREATE OR REPLACE FUNCTION public.public_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with s as (select public.app_settings() a, public.mobile_money_settings() m)
  select jsonb_build_object(
    'appName', a->'appName', 'checkoutMode', a->'checkoutMode', 'webCheckoutUrl', a->'webCheckoutUrl', 'supportEmail', a->'supportEmail',
    'legal', jsonb_build_object('terms', a->'termsUrl', 'salesTerms', a->'salesTermsUrl', 'privacy', a->'privacyUrl', 'legalNotice', a->'legalNoticeUrl'),
    'paypal', jsonb_build_object('enabled', coalesce((a->>'paypalEnabled')::boolean, false), 'currencies', '["EUR"]'::jsonb),
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
$function$;

CREATE OR REPLACE FUNCTION public.svc_create_order(p_user uuid, p_ebooks uuid[], p_idem text, p_platform text, p_shipping jsonb DEFAULT '{}'::jsonb, p_address_id uuid DEFAULT NULL::uuid, p_method text DEFAULT 'CARD'::text, p_mm_country text DEFAULT NULL::text, p_mm_operator text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_method not in ('CARD', 'MOBILE_MONEY', 'PAYPAL') then raise exception 'Moyen de paiement inconnu.' using errcode = 'PT400'; end if;
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

  -- PayPal : activé par l'admin, et uniquement en euros (PayPal n'accepte ni le KMF ni le MGA).
  if p_method = 'PAYPAL' then
    if not coalesce((public.app_settings()->>'paypalEnabled')::boolean, false) then
      raise exception 'Le paiement PayPal n''est pas disponible.' using errcode = 'PT409';
    end if;
    if cur <> 'EUR' then raise exception 'PayPal accepte uniquement les commandes en euros (EUR).' using errcode = 'PT400'; end if;
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
end $function$;
