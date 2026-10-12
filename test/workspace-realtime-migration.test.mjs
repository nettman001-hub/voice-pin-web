import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = fs.readFileSync(new URL('../supabase/migrations/202610120001_workspace_realtime.sql', import.meta.url), 'utf8');
const tables = ['sales', 'buyer_promise_defaults', 'customer_messages', 'purchase_claims', 'invoices', 'payment_receipts', 'shipments', 'verified_sales'];

test('Realtime migration is idempotent, includes verification/shipments and preserves unrelated publication entries', async () => {
  const db = new PGlite();
  try {
    for (const table of [...tables, 'unrelated']) await db.exec(`create table public.${table} (id text primary key, workspace_id uuid); alter table public.${table} enable row level security;`);
    await db.exec('create publication supabase_realtime for table public.unrelated, public.customer_messages;');
    await db.exec(migration); await db.exec(migration);
    const published = (await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows.map((row) => row.tablename);
    assert.deepEqual(published, [...tables, 'unrelated'].sort());
    const protectedTables = (await db.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity order by relname")).rows.map((row) => row.relname);
    assert.deepEqual(protectedTables, [...tables, 'unrelated'].sort(), 'The migration must not weaken row-level security');
  } finally { await db.close(); }
});

test('Realtime migration supports a partial schema and missing publication without creating application tables', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.verified_sales(workspace_id uuid, sale_id text, primary key(workspace_id, sale_id));');
    await db.exec(migration); await db.exec(migration);
    const published = (await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows.map((row) => row.tablename);
    assert.deepEqual(published, ['verified_sales']);
    assert.equal((await db.query("select to_regclass('public.sales') as table_id")).rows[0].table_id, null);
  } finally { await db.close(); }
});
