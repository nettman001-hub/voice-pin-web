-- Runs on the linked database without committing any synthetic record.
begin;
create temporary table voice_sale_smoke_result (result jsonb) on commit drop;
do $$
declare
  v_owner uuid;
  v_workspace uuid;
  v_session uuid;
  v_buyer uuid;
  v_operation uuid := gen_random_uuid();
  v_sale_id text := 's-' || v_operation::text;
  v_recognized_at timestamptz := now();
  v_first jsonb;
  v_replay jsonb;
  v_duplicate jsonb;
  v_repeat_before jsonb;
  v_repeat_after jsonb;
begin
  select id into v_owner from auth.users limit 1;
  if v_owner is null then raise exception 'No auth user is available for the rolled-back smoke test'; end if;
  insert into public.workspaces (name, owner_id) values ('rolled-back-voice-sale-smoke', v_owner)
    returning id into v_workspace;
  insert into public.live_sessions (workspace_id, display_code, status)
    values (v_workspace, 'smoke', 'ACTIVE') returning id into v_session;
  insert into public.buyers (workspace_id, platform_user_id, display_nickname)
    values (v_workspace, 'smoke-buyer', '햇살') returning id into v_buyer;
  insert into public.live_comments (workspace_id, session_id, collector_id, platform_message_id,
    buyer_id, nickname_snapshot, content, captured_at, ingest_sequence)
    values (v_workspace, v_session, gen_random_uuid(), 'smoke-comment', v_buyer,
      '햇살', 'ㅈㅇ', v_recognized_at - interval '2 seconds', 1);

  v_first := public.voicecap_commit_voice_sale(v_workspace, 'smoke', v_operation,
    v_sale_id, v_session, v_session::text || ':smoke-comment', 'smoke-comment',
    null, '001', 'smoke product', 15000, '햇살언니께 1.5 드리겠습니다',
    v_recognized_at, '1.5');
  if v_first->>'ok' <> 'true' then raise exception 'First commit failed: %', v_first; end if;
  v_replay := public.voicecap_commit_voice_sale(v_workspace, 'smoke', v_operation,
    v_sale_id, v_session, v_session::text || ':smoke-comment', 'smoke-comment',
    null, '001', 'smoke product', 15000, '햇살언니께 1.5 드리겠습니다',
    v_recognized_at, '1.5');
  if v_replay <> v_first then raise exception 'Idempotent replay differed: % / %', v_first, v_replay; end if;
  if (select count(*) from public.sales where id = v_sale_id) <> 1 then
    raise exception 'Sale count is not one';
  end if;
  if (select count(*) from public.sale_comment_sources where sale_id = v_sale_id) <> 1 then
    raise exception 'Comment evidence was not linked';
  end if;
  v_duplicate := public.voicecap_commit_voice_sale(v_workspace, 'smoke', gen_random_uuid(),
    's-' || gen_random_uuid()::text, v_session, v_session::text || ':smoke-comment', 'smoke-comment',
    null, '002', 'smoke duplicate', 15000, '햇살언니께 1.5 드리겠습니다',
    v_recognized_at, '1.5');
  if v_duplicate->>'code' <> 'REQUEST_ALREADY_ALLOCATED' then
    raise exception 'Second allocation was not rejected: %', v_duplicate;
  end if;
  insert into public.live_comments (workspace_id, session_id, collector_id, platform_message_id,
    buyer_id, nickname_snapshot, content, captured_at, ingest_sequence)
    values (v_workspace, v_session, gen_random_uuid(), 'repeat-before', v_buyer,
      '햇살', '저요', v_recognized_at - interval '1 second', 2);
  v_repeat_before := public.voicecap_commit_voice_sale(v_workspace, 'smoke', gen_random_uuid(),
    's-' || gen_random_uuid()::text, v_session, v_session::text || ':repeat-before', 'repeat-before',
    null, '002', 'smoke duplicate', 15000, '햇살언니께 1.5 드리겠습니다',
    v_recognized_at, '1.5');
  if v_repeat_before->>'code' <> 'REPEATED_INTENT_ALREADY_ALLOCATED' then
    raise exception 'Repeated pre-sale intent was not rejected: %', v_repeat_before;
  end if;
  insert into public.live_comments (workspace_id, session_id, collector_id, platform_message_id,
    buyer_id, nickname_snapshot, content, captured_at, ingest_sequence)
    values (v_workspace, v_session, gen_random_uuid(), 'repeat-after', v_buyer,
      '햇살', '저요', v_recognized_at + interval '1 second', 3);
  v_repeat_after := public.voicecap_commit_voice_sale(v_workspace, 'smoke', gen_random_uuid(),
    's-' || gen_random_uuid()::text, v_session, v_session::text || ':repeat-after', 'repeat-after',
    null, '003', 'smoke repeat purchase', 15000, '햇살언니께 1.5 드리겠습니다',
    v_recognized_at + interval '2 seconds', '1.5');
  if v_repeat_after->>'ok' <> 'true' then
    raise exception 'New post-sale request failed: %', v_repeat_after;
  end if;
  insert into voice_sale_smoke_result values (jsonb_build_object(
    'committedOnce', true, 'replayIdentical', true, 'duplicateRejected', true,
    'repeatedPreSaleRejected', true, 'newPostSaleAccepted', true,
    'buyerLinked', v_first->>'buyerId' = v_buyer::text));
end;
$$;
select result from voice_sale_smoke_result;
rollback;
