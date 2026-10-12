-- Event-driven workspace sync requires every subscribed table, including
-- verification and shipments, to participate in Realtime. Existing unrelated
-- publication tables and their settings are preserved.
do $$
declare
  target text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach target in array array[
    'sales', 'buyer_promise_defaults', 'customer_messages', 'purchase_claims',
    'invoices', 'payment_receipts', 'shipments', 'verified_sales'
  ] loop
    if to_regclass(format('public.%I', target)) is not null and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end $$;
