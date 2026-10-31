import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchPcPrintRelay, pcRelayPrinterReadiness } from '../src/services/touchPcPrintRelay.ts';

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const job = () => ({
  id: 'job-1', sale_id: 'sale-1', sale_revision: 3,
  immutable_payload: { buyerNickname: '구매자', amount: 15000, recognizedAt: '2026-11-01T00:00:00Z', slipLine: '2번 · 블랙 M', sessionDisplayCode: '20261101-1' },
});

function fixture(t, overrides = {}) {
  const calls = [], printed = [], statuses = [], errors = [];
  let connected = true, available = true, changes = 0;
  const api = {
    async printRelay(kind, relayId, ready, printerName) {
      calls.push(['presence', kind, relayId, ready, printerName]);
      return overrides.presence?.(kind);
    },
    async claimRelayPrints(relayId) {
      calls.push(['claim', relayId]);
      if (overrides.claim) return overrides.claim();
      const jobs = available ? [job()] : [];
      available = false;
      return { jobs, leaseToken: 'print-lease' };
    },
    async print(...args) { calls.push(['print', ...args]); return overrides.ack?.(...args); },
  };
  const relay = new TouchPcPrintRelay({
    api, relayId: 'relay-1',
    readiness: () => overrides.readiness?.() || pcRelayPrinterReadiness(connected),
    connected: () => connected,
    print: async payload => {
      printed.push(payload);
      return overrides.print ? overrides.print(payload) : { ok: true, status: 'PRINTED' };
    },
    onStatus: status => statuses.push(status),
    onError: error => errors.push(error),
    onChange: () => { changes++; },
  });
  t.after(async () => { await relay.stop(); await settle(); });
  return { relay, calls, printed, statuses, errors, setConnected: value => { connected = value; }, changes: () => changes };
}

test('relay owns only its independent presence and receipt jobs, preserving helper receipt content', async t => {
  const f = fixture(t);
  await f.relay.start(); await settle();
  assert.deepEqual(f.calls[0], ['presence', 'START', 'relay-1', true, undefined]);
  assert.deepEqual(f.printed, [{
    saleId: 'sale-1', printRevision: 3, buyerNickname: '구매자', amount: 15000,
    recognizedAt: '2026-11-01T00:00:00Z', sessionId: '2번 · 블랙 M · 20261101-1 회차',
  }]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'print'), [
    ['print', 'BEGIN', 'job-1', 'print-lease'], ['print', 'ACK', 'job-1', 'print-lease', 'SUCCESS'],
  ]);
  assert.equal(f.changes(), 1);
  assert.ok(f.statuses.at(-1).lastPrintAt > 0);
  await f.relay.stop();
  assert.equal(f.calls.at(-1)[1], 'STOP');
});

test('browser readiness states only helper connectivity while native settings must enable a printer', () => {
  assert.equal(pcRelayPrinterReadiness(false).ready, false);
  const browser = pcRelayPrinterReadiness(true);
  assert.equal(browser.ready, true);
  assert.equal(browser.verified, false);
  assert.match(browser.message, /프린터 설정은 도우미에서 확인/);
  assert.equal(pcRelayPrinterReadiness(true, { enabled: false, printerName: 'Windows Printer' }).ready, false);
  assert.equal(pcRelayPrinterReadiness(true, { enabled: true, printerName: '' }).ready, false);
  const configured = pcRelayPrinterReadiness(true, { enabled: true, printerName: 'Windows Printer' });
  assert.equal(configured.ready, true);
  assert.equal(configured.verified, true);
});

test('offline helper waits without claiming and reconnect updates presence before printing', async t => {
  const f = fixture(t); f.setConnected(false);
  await f.relay.start(); await settle();
  assert.equal(f.calls.some(call => call[0] === 'claim'), false);
  assert.equal(f.statuses.at(-1).ready, false);
  f.setConnected(true); f.relay.wake(); await settle(); f.relay.wake(); await settle();
  assert.ok(f.calls.some(call => call[0] === 'presence' && call[1] === 'HEARTBEAT' && call[3] === true));
  assert.equal(f.printed.length, 1);
});

test('overlapping wakes share one claim and a stopped late claim cannot begin physical output', async t => {
  const claim = deferred(), f = fixture(t, { claim: () => claim.promise });
  await f.relay.start(); await settle();
  for (let i = 0; i < 5; i++) f.relay.wake();
  await settle();
  assert.equal(f.calls.filter(call => call[0] === 'claim').length, 1);
  await f.relay.stop();
  claim.resolve({ jobs: [job()], leaseToken: 'print-lease' }); await settle();
  assert.equal(f.calls.some(call => call[0] === 'print'), false);
  assert.equal(f.printed.length, 0);
});

test('stopping during BEGIN records an unprinted failure and never sends to the helper', async t => {
  const begin = deferred(), f = fixture(t, { ack: kind => kind === 'BEGIN' ? begin.promise : undefined });
  await f.relay.start(); await settle(); await f.relay.stop();
  begin.resolve(); await settle();
  assert.equal(f.printed.length, 0);
  assert.ok(f.calls.some(call => call[1] === 'ACK' && call[4] === 'FAILED'));
});

test('stopping after dispatch retains the helper result ACK without starting another print', async t => {
  const print = deferred(), f = fixture(t, { print: () => print.promise });
  await f.relay.start(); await settle(); assert.equal(f.printed.length, 1);
  await f.relay.stop();
  print.resolve({ ok: true, status: 'PRINTED' }); await settle();
  assert.ok(f.calls.some(call => call[1] === 'ACK' && call[4] === 'SUCCESS'));
  assert.equal(f.printed.length, 1);
  assert.equal(f.changes(), 0, 'stopped component receives no late refresh');
});

test('helper timeout and thrown transport errors are UNKNOWN rather than safe-to-repeat failures', async t => {
  for (const mode of ['timeout', 'throw']) await t.test(mode, async child => {
    const f = fixture(child, { print: async () => {
      if (mode === 'throw') throw new Error('connection lost after sending');
      return { ok: false, status: 'FAILED', error: '댓글 도우미의 인쇄 응답 시간이 초과되었습니다.' };
    } });
    await f.relay.start(); await settle();
    assert.ok(f.calls.some(call => call[1] === 'ACK' && call[4] === 'UNKNOWN'));
    assert.equal(f.errors.length, 1);
  });
});

test('a rejected BEGIN never prints and a lost ACK never redispatches the same physical job', async t => {
  await t.test('BEGIN rejected', async child => {
    const f = fixture(child, { ack: async kind => { if (kind === 'BEGIN') throw new Error('PRINT_LEASE_LOST'); } });
    await f.relay.start(); await settle();
    assert.equal(f.printed.length, 0);
    assert.equal(f.calls.some(call => call[1] === 'ACK'), false);
  });
  await t.test('ACK lost', async child => {
    const f = fixture(child, { ack: async kind => { if (kind === 'ACK') throw new Error('network failed'); } });
    await f.relay.start(); await settle(); f.relay.wake(); await settle();
    assert.equal(f.printed.length, 1);
    assert.equal(f.errors.length, 1);
  });
});

test('lost relay ownership stops polling instead of taking the phone producer lease', async t => {
  const f = fixture(t, { presence: async kind => {
    if (kind === 'HEARTBEAT') throw Object.assign(new Error('another relay owns this workspace'), { code: 'PRINT_RELAY_LEASE_LOST' });
  } });
  await f.relay.start(); await settle(); f.relay.wake(); await settle();
  assert.equal(f.relay.running, false);
  const count = f.calls.length; f.relay.wake(); await settle();
  assert.equal(f.calls.length, count);
});

test('a late START after stopping releases its relay presence without starting a print loop', async t => {
  const start = deferred(), f = fixture(t, { presence: kind => kind === 'START' ? start.promise : undefined });
  const starting = f.relay.start(); await settle();
  await f.relay.stop(); start.resolve(); await starting; await settle();
  assert.equal(f.relay.running, false);
  assert.equal(f.calls.filter(call => call[0] === 'presence' && call[1] === 'STOP').length, 2);
  assert.equal(f.calls.some(call => call[0] === 'claim'), false);
});
