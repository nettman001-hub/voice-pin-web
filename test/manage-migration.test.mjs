import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const STUB = `create role anon; create role authenticated; create role service_role;
  create table workspaces(id uuid primary key);
  create function is_workspace_member(uuid) returns boolean language sql as $$ select true $$;
  create table operations(workspace_id uuid,operation_id uuid,actor_id text not null,action text,request_hash text,status text,
    response_json jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),primary key(workspace_id,operation_id));
  create table sales(id text primary key,workspace_id uuid,session_id text,buyer_id uuid,buyer_nickname text,amount integer,
    status text,record_state text not null default 'ACTIVE');
  create table invoices(id text primary key,workspace_id uuid,sale_ids jsonb not null default '[]',customer_nickname text not null,
    phone_number text not null,address text not null default '',amount integer not null,bank_account text not null,due_date date not null,
    status text not null check (status in ('DRAFT','QUEUED','SENT','PAID','CANCELLED')),sms_message_id text,sent_at timestamptz,
    deposit_code text,created_at timestamptz default now(),updated_at timestamptz default now());
  create unique index invoices_open_deposit_code_idx on invoices(workspace_id,deposit_code) where deposit_code is not null and status not in ('PAID','CANCELLED');
  create table payment_receipts(id text primary key,workspace_id uuid,sale_ids jsonb not null default '[]',match_status text not null);
  create table shipments(id text primary key,workspace_id uuid,sale_ids jsonb not null default '[]',recipient_name text not null,
    phone_number text not null default '',address text not null default '',carrier text not null default '',tracking_number text not null default '',
    status text not null check (status in ('READY','PACKED','SHIPPED','DELIVERED','CANCELLED')),memo text not null default '',
    sms_message_id text,shipped_at timestamptz,delivered_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
  create table workspace_settings(workspace_id uuid,namespace text,value jsonb not null default '{}',updated_at timestamptz default now(),primary key(workspace_id,namespace));`;

const sql = fs.readFileSync(new URL('../supabase/migrations/202611030001_manage_fulfillment.sql', import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite();
  await db.exec(STUB);
  const ws = crypto.randomUUID();
  await db.query('insert into workspaces values($1)', [ws]);
  const sales = [
    ['k1', '가가가', 20000, '확정'], ['k2', '가가가', 15000, '확정'], ['n1', '가가가', 10000, '확정'],
    ['u1', '가가가', 9000, '확정'], ['h1', '가가가', 5000, '보류'], ['o1', '나나나', 7000, '확정'],
  ];
  for (const [id, nick, amount, status] of sales) {
    await db.query('insert into sales(id,workspace_id,session_id,buyer_nickname,amount,status) values($1,$2,$3,$4,$5,$6)',
      [id, ws, 'r1', nick, amount, status]);
  }
  await db.query(`insert into payment_receipts values('p1',$1,'["k1","k2","n1","h1","o1"]','MATCHED')`, [ws]);
  // 옛 blob
  await db.query(`insert into workspace_settings values($1,'buyer_phone_links',$2),($1,'customer_keeping_records',$3)`, [ws,
    JSON.stringify({ '010-1111-2222': { nickname: '가가가', linkedAt: '2026-10-01T00:00:00Z' }, '01033334444': { nickname: '다다다', linkedAt: '2026-10-01T00:00:00Z', blocked: true }, bad: { nickname: 'x' } }),
    JSON.stringify([{ id: 'keep1', buyerNickname: '나나나', saleIds: ['o1', 'missing'], status: 'KEPT', keptAt: '2026-10-05T00:00:00Z' }, { id: 'keep2', saleIds: ['n1'], status: 'RELEASED' }])]);
  await db.exec(sql);
  await db.exec(sql); // 두 번 적용해도 된다
  const run = async (action, payload) => (await db.query('select voicecap_manage($1,$2,$3,$4) r', [ws, 'actor-1', action, { operationId: crypto.randomUUID(), ...payload }])).rows[0].r;
  return { db, ws, run };
}

test('legacy blobs are copied once and never deleted', async () => {
  const { db, ws } = await setup();
  const contacts = (await db.query('select phone,nickname,state,source,buyer_key from buyer_contacts order by phone')).rows;
  assert.deepEqual(contacts, [
    { phone: '01011112222', nickname: '가가가', state: 'LINKED', source: 'LEGACY', buyer_key: null },
    { phone: '01033334444', nickname: '다다다', state: 'BLOCKED', source: 'LEGACY', buyer_key: null },
  ]);
  const items = (await db.query('select sale_id,state,legacy_nickname from fulfillment_items')).rows;
  assert.deepEqual(items, [{ sale_id: 'o1', state: 'KEPT', legacy_nickname: '나나나' }]);
  assert.equal((await db.query('select count(*)::int n from workspace_settings where workspace_id=$1', [ws])).rows[0].n, 2);
});

test('keep needs payment; reserve takes every kept item; two reservations cannot share an item', async () => {
  const { db, run } = await setup();
  const B = 'nickname:가가가';
  assert.equal((await run('keep', { buyerKey: B, saleIds: ['u1'] })).code, 'KEEP_REQUIRES_PAYMENT');
  assert.equal((await run('keep', { buyerKey: B, saleIds: ['h1'] })).code, 'SALE_NOT_BILLABLE');
  assert.equal((await run('keep', { buyerKey: B, saleIds: ['k1', 'k2'] })).ok, true);
  assert.equal((await run('keep', { buyerKey: B, saleIds: ['k1'] })).code, 'ITEM_STATE_CONFLICT');

  assert.equal((await run('shipment-reserve', { buyerKey: B, saleIds: ['k1', 'n1'] })).code, 'KEPT_ITEMS_MISSING');
  assert.equal((await run('shipment-reserve', { buyerKey: B, saleIds: ['k1', 'k2', 'u1'] })).code, 'SHIPMENT_ITEM_UNPAID');
  const reserved = await run('shipment-reserve', { buyerKey: B, saleIds: ['k1', 'k2', 'n1'], shippingFee: 0, feeBasis: 45000 });
  assert.equal(reserved.ok, true);
  const again = await run('shipment-reserve', { buyerKey: B, saleIds: ['k1', 'k2', 'n1'] });
  assert.equal(again.code, 'SHIPMENT_CONFLICT');
  const ship = (await db.query('select status,buyer_key,sale_ids,revision from shipments')).rows[0];
  assert.deepEqual(ship, { status: 'RESERVED', buyer_key: B, sale_ids: ['k1', 'k2', 'n1'], revision: 1 });

  // 취소하면 보관 상품은 다시 보관 중, 새 상품은 발송 대기(행 없음)
  assert.equal((await run('shipment-status', { shipmentId: reserved.shipmentId, status: 'CANCELLED', expectedRevision: 2 })).code, 'REVISION_CONFLICT');
  assert.equal((await run('shipment-status', { shipmentId: reserved.shipmentId, status: 'CANCELLED', expectedRevision: 1 })).ok, true);
  const states = Object.fromEntries((await db.query(`select sale_id,state from fulfillment_items where sale_id in ('k1','k2','n1')`)).rows.map((r) => [r.sale_id, r.state]));
  assert.deepEqual(states, { k1: 'KEPT', k2: 'KEPT' });
});

test('shipment moves forward only and carries its items', async () => {
  const { db, run } = await setup();
  const B = 'nickname:가가가';
  await run('keep', { buyerKey: B, saleIds: ['k1'] });
  const { shipmentId } = await run('shipment-reserve', { buyerKey: B, saleIds: ['k1', 'k2'] });
  assert.equal((await run('shipment-status', { shipmentId, status: 'SHIPPED' })).code, 'SHIPMENT_STATE_CONFLICT');
  assert.equal((await run('shipment-status', { shipmentId, status: 'PACKED' })).ok, true);
  assert.equal((await run('cancel-items', { buyerKey: B, saleIds: ['k1'] })).code, 'ITEM_STATE_CONFLICT');
  assert.equal((await run('shipment-status', { shipmentId, status: 'SHIPPED', carrier: 'CJ', trackingNumber: '123' })).ok, true);
  assert.equal((await run('shipment-status', { shipmentId, status: 'DELIVERED' })).ok, true);
  const rows = (await db.query(`select state from fulfillment_items where shipment_id=$1`, [shipmentId])).rows;
  assert.deepEqual(rows.map((r) => r.state), ['DELIVERED', 'DELIVERED']);
});

test('customer cancel leaves the reservation; paid cancel can be marked refunded', async () => {
  const { db, run } = await setup();
  const B = 'nickname:가가가';
  const { shipmentId } = await run('shipment-reserve', { buyerKey: B, saleIds: ['k1', 'k2'] });
  assert.equal((await run('cancel-items', { buyerKey: B, saleIds: ['k2'], reason: '고객 변심' })).ok, true);
  const ship = (await db.query('select sale_ids,revision from shipments where id=$1', [shipmentId])).rows[0];
  assert.deepEqual(ship.sale_ids, ['k1']);
  assert.equal(ship.revision, 2);
  const item = (await db.query(`select state,cancelled_by,shipment_id from fulfillment_items where sale_id='k2'`)).rows[0];
  assert.deepEqual(item, { state: 'CANCELLED', cancelled_by: 'CUSTOMER', shipment_id: null });
  assert.equal((await run('mark-refunded', { saleIds: ['k2'] })).updated, 1);
});

test('same operation id replays; a different payload with it is refused', async () => {
  const { db, ws } = await setup();
  const op = crypto.randomUUID();
  const call = (payload) => db.query('select voicecap_manage($1,$2,$3,$4) r', [ws, 'a', 'keep', { operationId: op, ...payload }]).then((r) => r.rows[0].r);
  const first = await call({ buyerKey: 'nickname:가가가', saleIds: ['k1'] });
  const second = await call({ buyerKey: 'nickname:가가가', saleIds: ['k1'] });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal((await call({ buyerKey: 'nickname:가가가', saleIds: ['k2'] })).code, 'OPERATION_PAYLOAD_MISMATCH');
  assert.equal((await db.query('select count(*)::int n from fulfillment_events where kind=$1', ['KEEP'])).rows[0].n, 1);
});

test('one open order invoice per session and buyer; sending is locked to one device', async () => {
  const { db, run } = await setup();
  const base = { sessionId: 'r1', buyerKey: 'nickname:가가가', nickname: '가가가', saleIds: ['k1', 'k2'], productAmount: 35000, shippingFee: 3000, phone: '01011112222', bankAccount: '국민 1', depositCode: 'A1' };
  const created = await run('invoice-create', base);
  assert.equal(created.ok, true);
  assert.equal(created.existing, false);
  const dup = await run('invoice-create', base);
  assert.equal(dup.existing, true);
  assert.equal(dup.invoiceId, created.invoiceId);
  assert.equal((await db.query('select amount from invoices')).rows[0].amount, 38000);

  const lease = await run('invoice-begin-send', { invoiceId: created.invoiceId });
  assert.equal(lease.ok, true);
  assert.equal((await run('invoice-begin-send', { invoiceId: created.invoiceId })).code, 'INVOICE_ALREADY_SENDING');
  assert.equal((await run('invoice-finish-send', { invoiceId: created.invoiceId, sendOperationId: crypto.randomUUID(), sent: true })).code, 'SEND_LEASE_LOST');
  const failed = await run('invoice-finish-send', { invoiceId: created.invoiceId, sendOperationId: lease.sendOperationId, sent: false, error: '문자 앱 연결 없음' });
  assert.equal(failed.status, 'DRAFT');
  assert.equal(failed.sendError, '문자 앱 연결 없음');
  const lease2 = await run('invoice-begin-send', { invoiceId: created.invoiceId });
  const sent = await run('invoice-finish-send', { invoiceId: created.invoiceId, sendOperationId: lease2.sendOperationId, sent: true, smsMessageId: null });
  assert.equal(sent.status, 'QUEUED');
  assert.equal((await run('invoice-begin-send', { invoiceId: created.invoiceId })).code, 'INVOICE_ALREADY_SENT');
  assert.equal((await run('invoice-begin-send', { invoiceId: created.invoiceId, resend: true })).ok, true);

  assert.equal((await run('invoice-cancel', { invoiceId: created.invoiceId })).ok, true);
  const next = await run('invoice-create', { ...base, depositCode: 'A2' });
  assert.equal(next.existing, false);
});

test('contact link: one phone, one buyer unless replaced; block and unlink', async () => {
  const { db, run } = await setup();
  assert.equal((await run('contact-link', { phone: '010-1', buyerKey: 'x' })).code, 'VALIDATION_ERROR');
  assert.equal((await run('contact-link', { phone: '01055556666', buyerKey: 'nickname:가가가', nickname: '가가가', source: 'MESSAGE' })).ok, true);
  assert.equal((await run('contact-link', { phone: '01055556666', buyerKey: 'nickname:나나나', nickname: '나나나' })).code, 'PHONE_LINKED_TO_OTHER');
  assert.equal((await run('contact-link', { phone: '01055556666', buyerKey: 'nickname:나나나', nickname: '나나나', replace: true })).ok, true);
  assert.equal((await run('contact-link', { phone: '01055556666', mode: 'BLOCK' })).ok, true);
  const row = (await db.query(`select state,nickname,buyer_key from buyer_contacts where phone='01055556666'`)).rows[0];
  assert.deepEqual(row, { state: 'BLOCKED', nickname: '나나나', buyer_key: 'nickname:나나나' });
  assert.equal((await run('contact-link', { phone: '01055556666', mode: 'UNLINK' })).ok, true);
  assert.equal((await db.query(`select count(*)::int n from buyer_contacts where phone='01055556666'`)).rows[0].n, 0);
});

test('legacy kept items without a key get one from the web, then count for reservations', async () => {
  const { run } = await setup();
  assert.equal((await run('backfill-buyer-keys', { buyerKey: 'nickname:나나나', saleIds: ['o1'] })).updated, 1);
  assert.equal((await run('shipment-reserve', { buyerKey: 'nickname:나나나', saleIds: [] })).code, 'VALIDATION_ERROR');
  assert.equal((await run('shipment-reserve', { buyerKey: 'nickname:나나나', saleIds: ['o1'] })).ok, true);
});
