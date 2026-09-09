-- VoiceCAP 임시 상품은 가격을 아직 듣지 못한 상태에서도 0원으로 등록될 수 있다.
-- 실제 판매 금액은 sales.amount에 별도로 보존되며 상품 단가는 나중에 수정 가능하다.

alter table public.products
  drop constraint if exists products_unit_price_check;

alter table public.products
  add constraint products_unit_price_check
  check (unit_price is null or (unit_price >= 0 and unit_price <= 99999999));

alter table public.product_drafts
  drop constraint if exists product_drafts_unit_price_check;

alter table public.product_drafts
  add constraint product_drafts_unit_price_check
  check (unit_price is null or (unit_price >= 0 and unit_price <= 99999999));

