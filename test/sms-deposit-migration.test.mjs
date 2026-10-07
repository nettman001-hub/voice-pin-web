import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  // Optional dependency not installed in this environment
}

const migration = fs.readFileSync(
  new URL('../supabase/migrations/202610070001_sms_deposit_matching.sql', import.meta.url),
  'utf8',
);

test('입금확인 마이그레이션: 두 번 실행해도 안전하고 제약이 동작한다', async (t) => {
  if (!PGlite) {
    t.skip('PGlite is not installed in this environment');
    return;
  }
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table public.workspaces(id uuid primary key);
      create table public.devices(id uuid primary key, workspace_id uuid);
      create function public.is_workspace_member(target uuid) returns boolean language sql as 'select true';
      create function public.is_workspace_manager(target uuid) returns boolean language sql as 'select true';
      create function public.set_updated_at() returns trigger language plpgsql as 'begin new.updated_at = now(); return new; end';
      create table public.payment_receipts(
        id text primary key, workspace_id uuid not null, external_id text, payer_name text not null,
        amount integer not null, paid_at timestamptz not null, memo text, sale_ids jsonb not null default '[]',
        invoice_id text, match_status text not null);
      create table public.invoices(
        id text primary key, workspace_id uuid not null, customer_nickname text not null, amount integer not null,
        status text not null, sale_ids jsonb not null default '[]', created_at timestamptz not null default now());
      create table public.customer_messages(id text primary key, workspace_id uuid);
      create table public.purchase_claims(id text primary key, workspace_id uuid);
      create publication supabase_realtime;
    `);
    await db.exec(migration);
    await db.exec(migration);

    const ws = crypto.randomUUID();
    await db.query('insert into public.workspaces values ($1)', [ws]);

    // 입금 새 칸과 기본값
    await db.query(
      "insert into public.payment_receipts (id, workspace_id, payer_name, amount, paid_at, match_status) values ('p1', $1, '김철수', 30000, now(), 'UNMATCHED')",
      [ws],
    );
    const payment = (await db.query("select source, candidate_ids from public.payment_receipts where id = 'p1'")).rows[0];
    assert.equal(payment.source, 'NOTIFICATION');
    assert.deepEqual(payment.candidate_ids, []);
    await assert.rejects(db.query(
      "insert into public.payment_receipts (id, workspace_id, payer_name, amount, paid_at, match_status, source) values ('p2', $1, 'x', 1, now(), 'UNMATCHED', 'OTHER')",
      [ws],
    ));

    // 미결 정산서끼리만 입금코드가 겹치지 않는다
    await db.query("insert into public.invoices (id, workspace_id, customer_nickname, amount, status, deposit_code) values ('i1', $1, '성훈맘', 30000, 'SENT', 'A7K2')", [ws]);
    await assert.rejects(db.query(
      "insert into public.invoices (id, workspace_id, customer_nickname, amount, status, deposit_code) values ('i2', $1, '하늘이', 10000, 'QUEUED', 'A7K2')",
      [ws],
    ));
    await db.query("update public.invoices set status = 'PAID' where id = 'i1'");
    await db.query("insert into public.invoices (id, workspace_id, customer_nickname, amount, status, deposit_code) values ('i3', $1, '하늘이', 10000, 'QUEUED', 'A7K2')", [ws]);

    // 별칭 표
    await db.query("insert into public.depositor_aliases (workspace_id, payer_name_normalized, buyer_nickname) values ($1, '김철수', '성훈맘')", [ws]);
    await assert.rejects(db.query(
      "insert into public.depositor_aliases (workspace_id, payer_name_normalized, buyer_nickname) values ($1, '김철수', '하늘이')",
      [ws],
    ));
    const rls = (await db.query("select relrowsecurity from pg_class where relname = 'depositor_aliases'")).rows[0];
    assert.equal(rls.relrowsecurity, true);

    // 실시간 게시
    const published = (await db.query(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename",
    )).rows.map((row) => row.tablename);
    assert.deepEqual(published, ['customer_messages', 'invoices', 'payment_receipts', 'purchase_claims']);
  } finally {
    await db.close();
  }
});
