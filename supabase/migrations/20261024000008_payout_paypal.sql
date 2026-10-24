-- Compte PayPal des vendeurs : reçoit l'argent des ventes (carte ou PayPal) par versement manuel de l'admin,
-- comme un compte bancaire. L'e-mail PayPal est chiffré ; seul un aperçu masqué est enregistré en clair.

alter table public.seller_payout_accounts drop constraint seller_payout_accounts_check;
alter table public.seller_payout_accounts add constraint seller_payout_accounts_check check (kind in ('BANK', 'PAYPAL') or operator is not null);
comment on column public.seller_payout_accounts.last4 is 'Aperçu affichable : 4 derniers caractères (IBAN, numéro) ou e-mail PayPal masqué.';

CREATE OR REPLACE FUNCTION public.my_payout_accounts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'country', a.country, 'operator', a.operator,
      'holderName', a.holder_name, 'bankName', a.bank_name, 'masked', case when a.kind = 'PAYPAL' then a.last4 else '****' || a.last4 end, 'isDefault', a.is_default, 'createdAt', a.created_at)
    order by a.is_default desc, a.created_at), '[]')
  from public.seller_payout_accounts a where a.user_id = public.current_active_uid()
$function$;

CREATE OR REPLACE FUNCTION public.admin_payouts_due()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('sellerId', x.seller_id, 'currency', x.currency, 'amountCents', x.amount, 'lines', x.lines,
      'seller', jsonb_build_object('name', p.name, 'email', p.email),
      'account', (select jsonb_build_object('id', a.id, 'kind', a.kind, 'country', a.country, 'operator', a.operator, 'holderName', a.holder_name,
          'bankName', a.bank_name, 'masked', case when a.kind = 'PAYPAL' then a.last4 else '****' || a.last4 end) from public.seller_payout_accounts a where a.user_id = x.seller_id and a.is_default))
    order by x.amount desc)
    from (select seller_id, currency, sum(net_cents) amount, count(*) lines from public.seller_earnings
          where status = 'AVAILABLE' and payout_id is null group by seller_id, currency having sum(net_cents) > 0) x
    join public.profiles p on p.id = x.seller_id), '[]');
end $function$;

CREATE OR REPLACE FUNCTION public.admin_mark_bank_payout(p_seller uuid, p_currency text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare admin uuid := public.require_admin(); amount int; acc public.seller_payout_accounts; pid uuid;
begin
  select coalesce(sum(net_cents), 0) into amount from public.seller_earnings
  where seller_id = p_seller and currency = p_currency and status = 'AVAILABLE' and payout_id is null;
  if amount <= 0 then raise exception 'Aucune somme à verser.' using errcode = 'PT409'; end if;
  -- Versement manuel : compte bancaire ou compte PayPal du vendeur (celui par défaut en priorité).
  select * into acc from public.seller_payout_accounts where user_id = p_seller and kind in ('BANK', 'PAYPAL') order by is_default desc, created_at limit 1;
  if acc.id is null then raise exception 'Ce vendeur n''a enregistré ni compte bancaire ni compte PayPal.' using errcode = 'PT409'; end if;
  insert into public.payouts (seller_id, account_id, method, currency, amount_cents, status, reference, created_by, paid_at)
  values (p_seller, acc.id, acc.kind, p_currency, amount, 'PAID', left(nullif(trim(p_reference), ''), 100), admin, now()) returning id into pid;
  update public.seller_earnings set status = 'PAID_OUT', payout_id = pid
  where seller_id = p_seller and currency = p_currency and status = 'AVAILABLE' and payout_id is null;
  perform public.audit('payout.' || lower(acc.kind::text), 'payout', pid::text, jsonb_build_object('seller', p_seller, 'currency', p_currency, 'amountCents', amount));
  return public.admin_payouts_due();
end $function$;
