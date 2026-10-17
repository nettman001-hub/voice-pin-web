import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { hasCommentPurchaseIntent } from '../src/services/commentNicknameVerifier.ts';

const readMigration = (name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('item-taking purchase migration agrees with client intent and preserves atomic commit guards', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table live_sessions(id uuid primary key, workspace_id uuid, status text,
        active_product_id uuid, revision integer default 1, updated_at timestamptz);
      create table live_comments(id uuid primary key, workspace_id uuid, session_id uuid,
        platform_message_id text, buyer_id uuid, nickname_snapshot text, content text, captured_at timestamptz);
      create table products(id uuid primary key default gen_random_uuid(), workspace_id uuid,
        session_id uuid, product_code text, name text, image_kind text, unit_price integer, source text);
      create table sales(id text primary key, workspace_id uuid, session_id text, product_id uuid,
        buyer_id uuid, buyer_nickname text, amount integer, unit_price integer, quantity integer,
        recognized_at timestamptz, raw_transcript text, status text, product_name text,
        product_code_snapshot text, product_name_snapshot text, record_state text, source text,
        source_comment_ids jsonb, operation_id uuid, purchase_request_id text, note text,
        print_status text, print_revision integer, revision integer default 1, updated_at timestamptz);
      create table operations(workspace_id uuid, operation_id uuid, actor_id text, action text,
        request_hash text, status text, response_json jsonb, primary key(workspace_id, operation_id));
      create table sale_comment_sources(workspace_id uuid, product_id uuid, comment_id uuid,
        sale_id text, primary key(sale_id, comment_id));
    `);
    await db.exec(readMigration('202609300001_purchase_first_voice_sales.sql'));
    const workspace = crypto.randomUUID(), session = crypto.randomUUID();
    const recognizedAt = '2026-10-17T11:11:34.239Z';
    await db.query("insert into live_sessions(id,workspace_id,status) values($1,$2,'ACTIVE')", [session, workspace]);
    const addComment = async (content, overrides = {}) => {
      const value = { id: crypto.randomUUID(), message: crypto.randomUUID(), buyer: crypto.randomUUID(),
        capturedAt: '2026-10-17T11:11:33.239Z', ...overrides };
      await db.query('insert into live_comments values($1,$2,$3,$4,$5,$6,$7,$8)',
        [value.id, workspace, session, value.message, value.buyer, '하니', content, value.capturedAt]);
      return value;
    };
    const call = async (comment, overrides = {}) => {
      const options = { operation: crypto.randomUUID(), sale: `s-${crypto.randomUUID()}`, recognizedAt,
        amount: 12000, ...overrides };
      const result = await db.query('select voicecap_commit_voice_sale($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) result',
        [workspace, 'test', options.operation, options.sale, session, `${session}:${comment.message}`,
          comment.message, null, '001', '상품', options.amount, '하니님 드릴게요. 가격은 1.2.', options.recognizedAt, '1.2']);
      return result.rows[0].result;
    };

    const operational = await addComment('아까꺼 할께요');
    assert.equal((await call(operational)).code, 'COMMENT_NOT_ELIGIBLE', 'old RPC reproduces the production rejection');
    const migration = readMigration('202610170001_item_take_purchase_intent.sql');
    await db.exec(migration);
    await db.exec(migration);
    const operation = crypto.randomUUID(), sale = `s-${crypto.randomUUID()}`;
    const first = await call(operational, { operation, sale });
    assert.equal(first.ok, true);
    assert.equal(first.buyerId, operational.buyer);
    assert.deepEqual(await call(operational, { operation, sale }), first, 'operation replay is unchanged');
    assert.equal((await call(operational)).code, 'REQUEST_ALREADY_ALLOCATED');
    assert.equal((await call(operational, { operation, sale, amount: 13000 })).code, 'OPERATION_PAYLOAD_MISMATCH');
    const saved = (await db.query('select status,source_comment_ids,print_revision from sales where id=$1', [sale])).rows[0];
    assert.equal(saved.status, '자동저장');
    assert.deepEqual(saved.source_comment_ids, [operational.id]);
    assert.equal(saved.print_revision, 1);

    for (const content of ['아까꺼 할게요', '이거 할게요', '제가 이거 할게요!', '네, 아까꺼 할께요',
      '아까 거 할게요', '요거는 할게요', '\n이거 할게요\n', 'ㅈㅇ', '저요', '제가 살께요']) {
      assert.equal(hasCommentPurchaseIntent(content), true, content);
      assert.equal((await call(await addComment(content))).ok, true, content);
    }
    for (const content of ['연락할게요', '확인할게요', '이거 확인할게요', '아까꺼 연락할게요',
      '아까꺼 취소할게요', '아까꺼 안 할게요', '가능하면 이거 할게요', '이거 있으면 할게요',
      '맞으면 아까꺼 할게요', '아까꺼 할게요?', '아까꺼 할게요 취소요',
      '아까꺼 할게요라고 했어요', '"아까꺼 할게요"', '네', 'ㅇ', '롱', '할게요']) {
      assert.equal(hasCommentPurchaseIntent(content), false, content);
      assert.equal((await call(await addComment(content))).code, 'COMMENT_NOT_ELIGIBLE', content);
    }
    for (const capturedAt of ['2026-10-17T11:06:34.238Z', '2026-10-17T11:11:44.240Z']) {
      assert.equal((await call(await addComment('이거 할게요', { capturedAt }))).code, 'COMMENT_NOT_ELIGIBLE');
    }
    const withdrawn = await addComment('이거 할게요');
    await addComment('취소요', { buyer: withdrawn.buyer, capturedAt: '2026-10-17T11:11:34.000Z' });
    assert.equal((await call(withdrawn)).code, 'REQUEST_WITHDRAWN');
    const repeat = await addComment('아까꺼 할께요', { buyer: operational.buyer });
    assert.equal((await call(repeat)).code, 'REPEATED_INTENT_ALREADY_ALLOCATED');
    const next = await addComment('이거 할게요', { buyer: operational.buyer, capturedAt: '2026-10-17T11:11:35.000Z' });
    assert.equal((await call(next, { recognizedAt: '2026-10-17T11:11:36.000Z' })).ok, true);
    await db.query("update live_sessions set status='ENDED' where id=$1", [session]);
    assert.equal((await call(await addComment('이거 할게요'))).code, 'SESSION_ENDED');
  } finally {
    await db.close();
  }
});
