-- 댓글 도우미가 Windows 로컬 프린터로 출력한 판매 전표의 현재 상태를 보관한다.
-- print_revision은 동일 판매를 수정했을 때 새 출력 작업을 구분해 중복 인쇄를 막는다.
alter table public.sales
  add column if not exists print_status text not null default 'NOT_REQUESTED'
    check (print_status in ('NOT_REQUESTED', 'QUEUED', 'PRINTED', 'FAILED')),
  add column if not exists print_revision integer not null default 0 check (print_revision >= 0),
  add column if not exists printed_at timestamptz,
  add column if not exists print_error text;
