-- Libellés en français : « livre » au lieu du terme anglais « e-book » dans les messages renvoyés par le serveur.

CREATE OR REPLACE FUNCTION public.admin_delete_ebook(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.ebooks; paths jsonb;
begin
  perform public.require_admin();
  select * into e from public.ebooks where id = p_id;
  if e.id is null then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
  if e.status <> 'DRAFT' or exists (select 1 from public.order_items where ebook_id = p_id) or exists (select 1 from public.entitlements where ebook_id = p_id) then
    raise exception 'Seul un brouillon jamais commandé peut être supprimé. Archivez-le plutôt.' using errcode = 'PT409';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('path', storage_path, 'kind', kind)), '[]') into paths from public.ebook_files where ebook_id = p_id;
  delete from public.ebooks where id = p_id;
  perform public.audit('ebook.delete', 'ebook', p_id::text, jsonb_build_object('title', e.title));
  return paths;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_ebook(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.ebooks;
begin
  perform public.require_admin();
  select * into e from public.ebooks where id = p_id;
  if e.id is null then raise exception 'Livre introuvable.' using errcode = 'PT404'; end if;
  return public.admin_ebook_json(e);
end $function$
;

CREATE OR REPLACE FUNCTION public.cart_add(p_ebook uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := public.current_active_uid(); e public.ebooks;
begin
  select * into e from public.ebooks where id = p_ebook and status = 'PUBLISHED' and price_cents is not null;
  if e.id is null then raise exception 'Livre indisponible.' using errcode = 'PT404'; end if;
  if e.seller_id = uid then raise exception 'Vous ne pouvez pas acheter votre propre livre.' using errcode = 'PT409'; end if;
  if e.kind = 'DIGITAL' and p_ebook = any(public.owned_ids(uid)) then
    raise exception 'Ce livre est déjà dans votre bibliothèque.' using errcode = 'PT409';
  end if;
  if e.kind = 'PHYSICAL' and coalesce(e.stock, 0) = 0 then raise exception 'Ce livre est épuisé.' using errcode = 'PT409'; end if;
  insert into public.cart_items (user_id, ebook_id) values (uid, p_ebook) on conflict do nothing;
  return public.cart_get();
end $function$
;

CREATE OR REPLACE FUNCTION public.ebook_detail(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.ebooks; is_owned boolean;
begin
  select * into e from public.ebooks where slug = p_slug;
  is_owned := e.id is not null and e.id = any(public.owned_ids(auth.uid()));
  if e.id is null or (e.status <> 'PUBLISHED' and not is_owned) then
    raise exception 'Livre introuvable.' using errcode = 'PT404';
  end if;
  insert into public.ebook_views (ebook_id) values (e.id);
  return public.ebook_json(e, is_owned);
end $function$
;

CREATE OR REPLACE FUNCTION public.save_progress(p_ebook uuid, p_chapter integer, p_block integer, p_percent integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid := public.current_active_uid();
begin
  if not (p_ebook = any(public.owned_ids(uid))) then
    raise exception 'Vous n''avez pas accès à ce livre.' using errcode = '42501';
  end if;
  insert into public.reading_progress (user_id, ebook_id, chapter_index, block_index, percent, updated_at)
  values (uid, p_ebook, greatest(p_chapter, 0), greatest(p_block, 0), least(greatest(p_percent, 0), 100), now())
  on conflict (user_id, ebook_id) do update set chapter_index = excluded.chapter_index, block_index = excluded.block_index,
    percent = excluded.percent, updated_at = excluded.updated_at;
  return jsonb_build_object('chapterIndex', p_chapter, 'blockIndex', p_block, 'percent', p_percent, 'updatedAt', now());
end $function$
;

