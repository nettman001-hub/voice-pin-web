import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as rules from '../supabase/functions/sales-api/handlers/touchSalesCore.ts';

const source = ts.transpileModule(
  fs.readFileSync(new URL('../supabase/functions/sales-api/handlers/touchSales.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const auth = {actorType:'USER',workspaceId:crypto.randomUUID(),actorId:crypto.randomUUID()};
function handler(result) {
  const module = {exports:{}};
  const calls = [];
  vm.runInNewContext(source, {
    module, exports:module.exports, console, Date, JSON,
    require: name => name.includes('touchSalesCore') ? rules : {
      admin:{rpc:async(name,payload)=>{calls.push({name,payload});return {data:result,error:null};}},
      successResponse:data=>({ok:true,data}),
      errorResponse:(code,message,status=400)=>({ok:false,code,message,status}),
    },
  });
  return {run:module.exports.handleTouchSales,calls};
}

test('a stopped phone sale is still rejected with a device-neutral recovery message',async()=>{
  const h=handler({ok:false,code:'TOUCH_NOT_RUNNING'});
  const response=await h.run(auth,{action:'commit-touch-sale',sale:{
    operationId:crypto.randomUUID(),sessionId:crypto.randomUUID(),
    inputPrice:'1.5',unitPrice:15000,quantity:1,confirmedAt:new Date().toISOString(),
    comment:{platformMessageId:'phone-comment',nickname:'구매자',content:'저요',capturedAt:new Date().toISOString()},
  }});
  assert.equal(response.ok,false);
  assert.equal(response.code,'TOUCH_NOT_RUNNING');
  assert.equal(response.status,409);
  assert.doesNotMatch(response.message,/PC/);
  assert.match(response.message,/판매 화면/);
  assert.equal(h.calls[0].name,'voicecap_commit_touch_sale');
});

test('phone session and ownership guards keep their error codes without PC-only instructions',async()=>{
  for(const code of ['SESSION_ENDED','PC_ALREADY_RUNNING','PC_LEASE_LOST','CAPTURE_LEASE_LOST']) {
    const h=handler({ok:false,code});
    const response=await h.run(auth,{
      action:'touch-run',kind:'HEARTBEAT',producerId:crypto.randomUUID(),sessionId:crypto.randomUUID(),
      settings:{prepareSeconds:4,fallbackDelaySeconds:0},state:{phoneOnly:true},
    });
    assert.equal(response.code,code);
    assert.equal(response.status,409);
    assert.doesNotMatch(response.message,/PC/);
    assert.equal(h.calls[0].payload.p_state.state.phoneOnly,true);
  }
});
