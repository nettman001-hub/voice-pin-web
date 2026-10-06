import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("workflow database enforces revisions, observation gate, atomic stock and idempotency", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);
 create table workspaces(id uuid primary key,owner_id uuid);
 create table live_sessions(id uuid primary key,workspace_id uuid,status text);
 create table live_comments(id uuid primary key,workspace_id uuid,session_id uuid,buyer_id uuid,nickname_snapshot text,content text,captured_at timestamptz);
 create table products(id uuid primary key default gen_random_uuid(),workspace_id uuid,session_id uuid,product_code text,name text,image_kind text,unit_price integer,source text);
 create table sales(id text primary key,workspace_id uuid,session_id text,product_id uuid,buyer_id uuid,buyer_nickname text,amount integer,unit_price integer,quantity integer,recognized_at timestamptz,raw_transcript text,status text,product_name text,product_code_snapshot text,product_name_snapshot text,record_state text,source text,source_comment_ids jsonb,operation_id uuid,purchase_request_id text,note text,print_status text,print_revision integer,revision integer default 1,updated_at timestamptz);
 create unique index request_once on sales(workspace_id,purchase_request_id);
 create table operations(workspace_id uuid,operation_id uuid,actor_id text,action text,request_hash text,status text,response_json jsonb,primary key(workspace_id,operation_id));
 create table sale_comment_sources(workspace_id uuid,product_id uuid,comment_id uuid,sale_id text,primary key(sale_id,comment_id));`,
    );
    await db.exec(
      fs.readFileSync(
        new URL(
          "../supabase/migrations/202610020001_seller_workflow_analysis.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      fs.readFileSync(
        new URL(
          "../supabase/migrations/202610020002_workflow_voice_commit.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const seller = crypto.randomUUID(),
      ws = crypto.randomUUID(),
      session = crypto.randomUUID(),
      analysis = crypto.randomUUID();
    await db.query("insert into auth.users values($1)", [seller]);
    await db.query("insert into workspaces values($1,$2)", [ws, seller]);
    await db.query("insert into live_sessions values($1,$2,'ACTIVE')", [
      session,
      ws,
    ]);
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].result;
    assert.equal(
      (await rpc(
        "select voicecap_save_workflow_analysis($1,null,$2,$3) result",
        [analysis, { id: analysis, revision: 1 }, seller],
      )).ok,
      true,
    );
    assert.equal(
      (await rpc("select voicecap_save_workflow_analysis($1,1,$2,$3) result", [
        analysis,
        { revision: 2 },
        seller,
      ])).ok,
      true,
    );
    assert.equal(
      (await rpc("select voicecap_save_workflow_analysis($1,1,$2,$3) result", [
        analysis,
        { revision: 2, forged: true },
        seller,
      ])).code,
      "REVISION_CONFLICT",
    );
    const profile = crypto.randomUUID();
    await db.query(
      "insert into seller_workflow_profiles(id,seller_user_id,analysis_id,report_version,profile,created_by) values($1,$2,$3,1,$4,$2)",
      [profile, seller, analysis, {}],
    );
    assert.equal(
      (await rpc(
        "select voicecap_deploy_workflow($1,$2,'SHADOW',0,$1,false) result",
        [seller, profile],
      )).ok,
      true,
    );
    assert.equal(
      (await rpc(
        "select voicecap_deploy_workflow($1,$2,'ACTIVE',1,$1,false) result",
        [seller, profile],
      )).code,
      "SHADOW_REVIEW_REQUIRED",
    );
    assert.equal(
      (await rpc(
        "select voicecap_deploy_workflow($1,$2,'SHADOW',1,$1,true) result",
        [seller, profile],
      )).code,
      "OBSERVATION_REQUIRED",
    );
    await db.query(
      "insert into seller_workflow_observations(seller_user_id,profile_id,session_id,decisions) values($1,$2,$3,$4)",
      [seller, profile, session, [{ status: "CONFIRMED" }]],
    );
    assert.equal(
      (await rpc(
        "select voicecap_deploy_workflow($1,$2,'SHADOW',0,$1,true) result",
        [seller, profile],
      )).code,
      "REVISION_CONFLICT",
    );
    assert.equal(
      (await db.query("select shadow_verified from seller_workflow_profiles"))
        .rows[0].shadow_verified,
      false,
    );
    assert.equal(
      (await rpc(
        "select voicecap_deploy_workflow($1,$2,'SHADOW',1,$1,true) result",
        [seller, profile],
      )).ok,
      true,
    );
    assert.equal(
      (await rpc(
        "select voicecap_deploy_workflow($1,$2,'ACTIVE',2,$1,false) result",
        [seller, profile],
      )).ok,
      true,
    );
    assert.equal(
      (await rpc(
        "select voicecap_deploy_workflow($1,$2,'SHADOW',1,$1,false) result",
        [seller, profile],
      )).code,
      "REVISION_CONFLICT",
    );
    assert.equal(
      (await rpc("select voicecap_pin_workflow($1,$2) result", [ws, session]))
        .profileId,
      profile,
    );
    assert.equal(
      (await rpc(
        "select voicecap_deploy_workflow($1,$2,'DEFAULT',3,$1,false) result",
        [seller, profile],
      )).ok,
      true,
    );
    assert.equal(
      (await rpc("select voicecap_pin_workflow($1,$2) result", [ws, session]))
        .profileId,
      profile,
    );
    const nextSession = crypto.randomUUID();
    await db.query("insert into live_sessions values($1,$2,'ACTIVE')", [
      nextSession,
      ws,
    ]);
    assert.equal(
      (await rpc("select voicecap_pin_workflow($1,$2) result", [
        ws,
        nextSession,
      ])).profileId,
      null,
    );
    const buyer = crypto.randomUUID(), comment = crypto.randomUUID();
    await db.query("insert into live_comments values($1,$2,$3,$4,$5,$6,$7)", [
      comment,
      ws,
      session,
      buyer,
      "햇살",
      "1",
      "2026-10-02T00:00:02Z",
    ]);
    const sale = "s-" + crypto.randomUUID(),
      operation = sale.slice(2),
      evidence = { offerId: "offer-1", profileId: profile };
    const decision = {
      status: "CONFIRMED",
      commentId: comment,
      nickname: "햇살",
      quantity: 2,
      unitPrice: 5000,
      amount: 10000,
      stock: 2,
      requestId: session + ":1",
      offerId: "offer-1",
      orderCode: "1",
      recognizedAt: "2026-10-02T00:00:10Z",
      rawTranscript: "햇살언니 드릴게요",
    };
    const call = (s, o, d, e = evidence) =>
      rpc("select voicecap_commit_workflow_sale($1,$2,$3,$4,$5,$6,$7) result", [
        ws,
        seller,
        o,
        s,
        session,
        d,
        e,
      ]);
    assert.equal(
      (await call(sale, operation, decision, {
        ...evidence,
        profileId: crypto.randomUUID(),
      })).code,
      "PROFILE_NOT_APPLIED",
    );
    assert.equal((await call(sale, operation, decision)).ok, true);
    assert.equal((await call(sale, operation, decision)).ok, true);
    assert.equal(
      (await db.query("select quantity,amount,buyer_nickname from sales")).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query("select quantity,amount,buyer_nickname from sales"))
        .rows[0].amount,
      10000,
    );
    const other = crypto.randomUUID(), otherBuyer = crypto.randomUUID();
    await db.query("insert into live_comments values($1,$2,$3,$4,$5,$6,$7)", [
      other,
      ws,
      session,
      otherBuyer,
      "마가린",
      "1",
      "2026-10-02T00:00:03Z",
    ]);
    const second = {
      ...decision,
      commentId: other,
      nickname: "마가린",
      requestId: session + ":2",
      quantity: 1,
      amount: 5000,
    };
    assert.equal(
      (await call("s-" + crypto.randomUUID(), crypto.randomUUID(), second))
        .code,
      "STOCK_CONFLICT",
    );
    assert.equal(
      (await db.query("select count(*)::int n from sales")).rows[0].n,
      1,
    );
    assert.equal(
      (await call("s-" + crypto.randomUUID(), crypto.randomUUID(), {
        ...second,
        stock: null,
      })).ok,
      true,
    );
    assert.equal(
      (await db.query("select count(*)::int n from sales")).rows[0].n,
      2,
    );
  } finally {
    await db.close();
  }
});
