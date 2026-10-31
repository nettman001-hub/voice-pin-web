import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as core from '../supabase/functions/sales-api/handlers/touchSalesCore.ts';

const source = fs.readFileSync(new URL('../supabase/functions/sales-api/handlers/touchSales.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const calls = [], reads = [], rows = {};
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date, Map, Set, Object,
    require: (name) => name.includes('touchSalesCore') ? core : {
      admin: {
        rpc: async (name, params) => { calls.push({ name, params }); return { data: { ok: true }, error: null }; },
        from: (table) => {
          const read = { table, filters: [] }; reads.push(read);
          return {
            select() { return this; },
            eq(column, value) { read.filters.push([column, value]); return this; },
            async maybeSingle() { return { data: rows[table] || null, error: null }; },
          };
        },
      },
      successResponse: (data) => ({ ok: true, data }),
      errorResponse: (code, message, status) => ({ ok: false, code, message, status }),
    },
  });
  const workspaceId = crypto.randomUUID();
  const auth = { actorType: 'USER', actorId: crypto.randomUUID(), workspaceId };
  return { calls, reads, rows, workspaceId, auth, handle: (body, actor = auth) => module.exports.handleTouchSales(actor, body) };
}

test('output actions reject devices and malformed arguments before invoking privileged RPCs', async () => {
  const h = harness(), relayId = crypto.randomUUID(), producerId = crypto.randomUUID();
  for (const body of [
    { action: 'touch-print-relay', kind: 'START', relayId, ready: true },
    { action: 'touch-print-target', producerId, printTarget: 'PC_HELPER' },
    { action: 'claim-touch-relay-jobs', relayId },
    { action: 'touch-print-relay-status' },
  ]) assert.equal((await h.handle(body, { ...h.auth, actorType: 'DEVICE' })).code, 'AUTH_REQUIRED');
  for (const body of [
    { action: 'touch-print-relay', kind: 'START', relayId: 'bad', ready: true },
    { action: 'touch-print-relay', kind: 'OTHER', relayId, ready: true },
    { action: 'touch-print-relay', kind: 'START', relayId, ready: 'true' },
    { action: 'touch-print-relay', kind: 'START', relayId, ready: true, printerName: {} },
    { action: 'touch-print-target', producerId: 'bad', printTarget: 'PC_HELPER' },
    { action: 'touch-print-target', producerId, printTarget: 'ANY_PC' },
    { action: 'claim-touch-relay-jobs', relayId: 'bad' },
  ]) assert.equal((await h.handle(body)).code, 'VALIDATION_ERROR');
  assert.equal(h.calls.length, 0);
  assert.equal(h.reads.length, 0);
});

test('relay and live-switch RPCs use authenticated workspace, bounded name, and exact routing fields', async () => {
  const h = harness(), relayId = crypto.randomUUID(), producerId = crypto.randomUUID();
  await h.handle({ action: 'touch-print-relay', kind: 'START', relayId, ready: true, printerName: 'x'.repeat(140), workspaceId: 'forged' });
  await h.handle({ action: 'touch-print-target', producerId, printTarget: 'PC_HELPER', workspaceId: 'forged' });
  await h.handle({ action: 'claim-touch-relay-jobs', relayId, workspaceId: 'forged' });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    { name: 'voicecap_touch_print_relay', params: { p_workspace_id: h.workspaceId, p_relay_id: relayId, p_kind: 'START', p_ready: true, p_printer_name: 'x'.repeat(120) } },
    { name: 'voicecap_touch_print_target', params: { p_workspace_id: h.workspaceId, p_producer_id: producerId, p_print_target: 'PC_HELPER' } },
    { name: 'voicecap_claim_touch_relay_jobs', params: { p_workspace_id: h.workspaceId, p_relay_id: relayId, p_limit: 10 } },
  ]);
});

test('cheap relay status and bootstrap report expired presence as not ready and scope reads', async () => {
  const h = harness(), relayId = crypto.randomUUID();
  assert.equal((await h.handle({ action: 'touch-print-relay-status' })).data.printRelay, null);
  h.rows.touch_print_relays = { relay_id: relayId, ready: true, lease_expires_at: new Date(Date.now() - 1000).toISOString(), printer_name: '전표 프린터' };
  const expired = await h.handle({ action: 'touch-print-relay-status', workspaceId: 'forged' });
  assert.equal(expired.data.printRelay.ready, false);
  assert.equal(expired.data.printRelay.printerName, '전표 프린터');
  assert.equal(h.reads.length, 2, 'status does not load sessions or sales');
  h.rows.touch_print_relays.lease_expires_at = new Date(Date.now() + 20000).toISOString();
  const boot = await h.handle({ action: 'touch-bootstrap' });
  assert.equal(boot.data.printRelay.ready, true);
  assert.equal(boot.data.printRelay.relayId, relayId);
  for (const read of h.reads) assert.ok(read.filters.some(([key, value]) => key === 'workspace_id' && value === h.workspaceId));
});

test('run settings accept supported output targets and give legacy phone clients a Bluetooth default', async () => {
  assert.equal(core.cleanTouchRunSettings({}).printTarget, 'PHONE_BLUETOOTH');
  assert.equal(core.cleanTouchRunSettings({ printTarget: 'PC_HELPER' }).printTarget, 'PC_HELPER');
  assert.equal(core.cleanTouchRunSettings({ printTarget: 'arbitrary' }).printTarget, 'PHONE_BLUETOOTH');
  const h = harness();
  await h.handle({ action: 'touch-run', kind: 'START', producerId: crypto.randomUUID(), sessionId: crypto.randomUUID(), settings: { printTarget: 'PC_HELPER' }, state: { phoneOnly: true } });
  assert.equal(h.calls[0].params.p_state.settings.printTarget, 'PC_HELPER');
  assert.equal(h.calls[0].params.p_state.state.phoneOnly, true);
});
