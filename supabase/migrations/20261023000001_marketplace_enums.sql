-- Marketplace : nouveaux types (fichier séparé : une valeur ajoutée à un enum doit être validée
-- avant d'être utilisée par la migration suivante).

alter type public.ebook_status add value if not exists 'PAUSED';

create type public.product_kind as enum ('PHYSICAL', 'DIGITAL');
create type public.book_condition as enum ('NEW', 'VERY_GOOD', 'GOOD', 'WORN');
create type public.shipping_mode as enum ('HAND', 'POST', 'COURIER');
create type public.shipment_status as enum ('TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELED');
create type public.payout_account_kind as enum ('BANK', 'MOBILE_MONEY');
create type public.earning_status as enum ('AVAILABLE', 'PAID_OUT', 'REVERSED');
create type public.payout_status as enum ('PROCESSING', 'PAID', 'FAILED');
