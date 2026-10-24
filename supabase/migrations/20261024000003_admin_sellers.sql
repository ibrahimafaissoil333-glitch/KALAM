-- Administration des vendeurs : ventes de chaque vendeur, et retrait d'une annonce à tout moment
-- (le vendeur est prévenu par e-mail ; ses acheteurs gardent l'accès aux livres numériques).

create or replace function public.admin_sellers(p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(x order by x->>'lastSaleAt' desc nulls last, x->>'name') from (
    select jsonb_build_object(
      'id', p.id, 'name', p.name, 'email', p.email, 'status', p.status, 'createdAt', p.created_at,
      'listings', jsonb_build_object(
        'onSale', (select count(*) from public.ebooks e where e.seller_id = p.id and e.status = 'PUBLISHED'),
        'paused', (select count(*) from public.ebooks e where e.seller_id = p.id and e.status = 'PAUSED'),
        'removed', (select count(*) from public.ebooks e where e.seller_id = p.id and e.status = 'ARCHIVED'),
        'total', (select count(*) from public.ebooks e where e.seller_id = p.id)),
      'sold', (select coalesce(sum(i.quantity), 0) from public.order_items i join public.orders o on o.id = i.order_id where i.seller_id = p.id and o.status = 'PAID'),
      'lastSaleAt', (select max(o.paid_at) from public.order_items i join public.orders o on o.id = i.order_id where i.seller_id = p.id and o.status in ('PAID', 'REFUNDED')),
      'totals', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'grossCents', gross, 'commissionCents', commission, 'netCents', net, 'availableCents', available) order by currency) from (
          select currency, sum(gross_cents) gross, sum(commission_cents) commission, sum(net_cents) net,
                 coalesce(sum(net_cents) filter (where status = 'AVAILABLE' and payout_id is null), 0) available
          from public.seller_earnings se where se.seller_id = p.id and se.status <> 'REVERSED' group by currency) t), '[]')) x
    from public.profiles p
    where exists (select 1 from public.ebooks e where e.seller_id = p.id)
      and (q is null or p.name ilike '%' || q || '%' or p.email ilike '%' || q || '%')) s), '[]');
end $$;

create or replace function public.admin_seller(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  perform public.require_admin();
  select * into p from public.profiles where id = p_id;
  if p.id is null then raise exception 'Vendeur introuvable.' using errcode = 'PT404'; end if;
  return jsonb_build_object(
    'id', p.id, 'name', p.name, 'email', p.email, 'status', p.status, 'createdAt', p.created_at,
    'listings', coalesce((select jsonb_agg(public.admin_ebook_json(e) order by e.updated_at desc) from public.ebooks e where e.seller_id = p.id), '[]'),
    'sales', coalesce((select jsonb_agg(s order by s->>'date' desc) from (
        select jsonb_build_object('orderId', o.id, 'reference', o.reference, 'date', coalesce(o.paid_at, o.created_at), 'status', o.status,
          'title', i.title, 'kind', i.kind, 'priceCents', i.price_cents, 'shippingCents', i.shipping_cents, 'currency', o.currency,
          'paymentMethod', o.payment_method,
          'buyer', (select jsonb_build_object('name', b.name, 'email', b.email) from public.profiles b where b.id = o.user_id),
          'netCents', (select se.net_cents from public.seller_earnings se where se.order_item_id = i.id and se.reason = 'SALE'),
          'commissionCents', (select se.commission_cents from public.seller_earnings se where se.order_item_id = i.id and se.reason = 'SALE')) s
        from public.order_items i join public.orders o on o.id = i.order_id
        where i.seller_id = p.id and o.status in ('PAID', 'REFUNDED')
        order by coalesce(o.paid_at, o.created_at) desc limit 500) x), '[]'),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'method', po.method, 'currency', po.currency, 'amountCents', po.amount_cents,
        'status', po.status, 'reference', coalesce(po.reference, po.provider_ref), 'paidAt', po.paid_at, 'createdAt', po.created_at) order by po.created_at desc)
      from public.payouts po where po.seller_id = p.id), '[]'));
end $$;

-- Retirer une annonce (n'importe quand, quel que soit son statut) ou la remettre en vente.
create or replace function public.admin_moderate_listing(p_id uuid, p_action text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.ebooks; mail text; why text := left(nullif(trim(coalesce(p_reason, '')), ''), 500); problems text[];
begin
  perform public.require_admin();
  select * into e from public.ebooks where id = p_id;
  if e.id is null then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
  if p_action = 'remove' then
    update public.ebooks set status = 'ARCHIVED', featured = false where id = p_id returning * into e;
    update public.promo_slides set active = false, updated_at = now() where ebook_id = p_id;
    delete from public.cart_items where ebook_id = p_id;
    if e.seller_id is not null then
      select email into mail from public.profiles where id = e.seller_id;
      perform public.queue_email(mail, 'listing_removed', format('Votre annonce « %s » a été retirée', e.title),
        format(E'Bonjour,\n\nL''équipe Kalam a retiré votre annonce « %s » de la vente.%s\n\nLes acheteurs qui l''ont déjà achetée la conservent. Pour toute question, répondez à cet e-mail.',
          e.title, case when why is null then '' else E'\n\nMotif : ' || why end));
    end if;
  elsif p_action = 'restore' then
    problems := public.book_problems(e);
    if cardinality(problems) > 0 then raise exception 'Remise en vente impossible : %.', array_to_string(problems, ', ') using errcode = 'PT400'; end if;
    update public.ebooks set status = 'PUBLISHED', published_at = coalesce(published_at, now()) where id = p_id returning * into e;
  else
    raise exception 'Action inconnue.' using errcode = 'PT400';
  end if;
  perform public.audit('listing.' || p_action, 'ebook', p_id::text, jsonb_build_object('title', e.title, 'seller', e.seller_id, 'reason', why));
  return public.admin_ebook_json(e);
end $$;

revoke execute on function public.admin_sellers(text), public.admin_seller(uuid), public.admin_moderate_listing(uuid, text, text) from public, anon;
grant execute on function public.admin_sellers(text), public.admin_seller(uuid), public.admin_moderate_listing(uuid, text, text) to authenticated;
