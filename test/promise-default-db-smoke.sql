-- Exercise the production schema without leaving synthetic customer data.
begin;
do $$
declare
  v_workspace uuid;
  v_key text := 'smoke:' || gen_random_uuid()::text;
  v_count integer;
begin
  select id into v_workspace from public.workspaces limit 1;
  if v_workspace is null then
    raise exception 'No workspace is available for the rollback smoke test';
  end if;

  insert into public.buyer_promise_defaults
    (workspace_id, buyer_key, buyer_nickname, session_id, status)
  values (v_workspace, v_key, 'rollback-smoke', 'rollback-smoke-session', 'CONFIRMED');

  select count(*) into v_count from public.buyer_promise_defaults
    where workspace_id = v_workspace and buyer_key = v_key and status = 'CONFIRMED';
  if v_count <> 1 then raise exception 'Confirmation was not saved exactly once'; end if;

  insert into public.buyer_promise_defaults
    (workspace_id, buyer_key, buyer_nickname, session_id, status)
  values (v_workspace, v_key, 'rollback-smoke', 'rollback-smoke-session', 'CANCELLED')
  on conflict (workspace_id, buyer_key, session_id) do update
    set status = excluded.status, updated_at = now();

  select count(*) into v_count from public.buyer_promise_defaults
    where workspace_id = v_workspace and buyer_key = v_key and status = 'CANCELLED';
  if v_count <> 1 then raise exception 'Cancellation did not replace confirmation'; end if;
end;
$$;
select 'confirmed_and_cancelled_in_one_broadcast' as result;
rollback;
