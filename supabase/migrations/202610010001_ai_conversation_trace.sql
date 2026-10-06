-- Preserve the prompts actually dispatched and raw model replies per attempt.
-- Apply this migration before deploying the sales-api conversation viewer code.
alter table public.ai_task_attempts
  add column if not exists conversation_trace jsonb default null;

comment on column public.ai_task_attempts.conversation_trace is
  'Actual dispatched system/user prompts and model response, excluding credentials; null for legacy attempts.';

-- AI requests contain customer comments and seller utterances. The original
-- queue migration allowed all authenticated accounts to read/write every row.
-- Only workspace members may read; trusted sales-api/service_role owns writes.
drop policy if exists ai_tasks_select_policy on public.ai_tasks;
drop policy if exists ai_tasks_write_policy on public.ai_tasks;
create policy ai_tasks_select_policy on public.ai_tasks
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists ai_attempts_select_policy on public.ai_task_attempts;
drop policy if exists ai_attempts_write_policy on public.ai_task_attempts;
create policy ai_attempts_select_policy on public.ai_task_attempts
  for select to authenticated
  using (exists (
    select 1 from public.ai_tasks task
    where task.task_id = ai_task_attempts.task_id
      and public.is_workspace_member(task.workspace_id)
  ));
