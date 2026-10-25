-- Compte Stripe de la plateforme : revenus de l'administrateur (commissions des vendeurs et ventes des
-- livres de la plateforme), et pourcentage de commission affiché aux vendeurs dans l'app.

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
    'commissionPercent', coalesce((a->>'commissionPercent')::numeric, 2),
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

-- Revenus de la plateforme par devise : commissions nettes (remboursements déduits), ventes de ses propres
-- livres, et encaissements par moyen de paiement ; détail des 12 derniers mois.
create or replace function public.admin_platform_revenue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'commissionPercent', coalesce((public.app_settings()->>'commissionPercent')::numeric, 2),
    'byCurrency', coalesce((select jsonb_agg(x order by x->>'currency') from (
      select jsonb_build_object('currency', cur,
        'commissionCents', (select coalesce(sum(se.commission_cents), 0) from public.seller_earnings se where se.currency = cur and se.status <> 'REVERSED'),
        'platformSalesCents', (select coalesce(sum(i.price_cents + i.shipping_cents), 0) from public.order_items i join public.orders o on o.id = i.order_id
                                where o.currency = cur and o.status = 'PAID' and i.seller_id is null),
        'collected', (select coalesce(jsonb_object_agg(m, t), '{}') from (select o.payment_method m, sum(o.total_cents) t from public.orders o
                       where o.currency = cur and o.status = 'PAID' group by o.payment_method) s),
        'owedToSellersCents', (select coalesce(sum(se.net_cents), 0) from public.seller_earnings se where se.currency = cur and se.status = 'AVAILABLE' and se.payout_id is null)) x
      from (select distinct currency cur from public.orders where status in ('PAID', 'REFUNDED')) c) y), '[]'),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'currency', cur, 'commissionCents', com) order by m desc, cur) from (
      select to_char(date_trunc('month', se.created_at), 'YYYY-MM') m, se.currency cur, sum(se.commission_cents) com
      from public.seller_earnings se where se.status <> 'REVERSED' and se.created_at > now() - interval '12 months' group by 1, 2) t), '[]'));
end $$;

revoke execute on function public.admin_platform_revenue() from public, anon;
grant execute on function public.admin_platform_revenue() to authenticated;
