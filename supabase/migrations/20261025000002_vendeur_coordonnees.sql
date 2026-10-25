-- Mise en vente : le vendeur doit avoir enregistré un moyen de réception de ses gains.

CREATE OR REPLACE FUNCTION public.seller_set_status(p_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := public.current_active_uid(); e public.ebooks; problems text[];
begin
  select * into e from public.ebooks where id = p_id and seller_id = uid;
  if e.id is null then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
  if p_action = 'publish' then
    problems := public.book_problems(e);
    if cardinality(problems) > 0 then raise exception 'Mise en vente impossible : %.', array_to_string(problems, ', ') using errcode = 'PT400'; end if;
    -- Le vendeur doit pouvoir être payé : au moins un moyen de réception (banque, PayPal ou Mobile Money).
    if not exists (select 1 from public.seller_payout_accounts a where a.user_id = uid) then
      raise exception 'Ajoutez d’abord vos coordonnées de paiement (compte bancaire, PayPal ou Mobile Money) pour recevoir l’argent de vos ventes.' using errcode = 'PT409';
    end if;
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
end $function$;
