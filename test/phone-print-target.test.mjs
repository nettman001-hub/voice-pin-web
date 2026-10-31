import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchPhoneProducer } from '../src/services/touchPhoneProducer.ts';

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(printTarget = 'PC_HELPER') {
  const state = { runs: [], claims: 0, captures: 0, saves: 0, sends: 0, acks: [], changes: [], rejectSwitch: false };
  const pending = [{ sale_id: 'sale-1', capture_generation: 'g1', capture_due_at: new Date().toISOString() }];
  let receipt = true;
  const producer = new TouchPhoneProducer({
    producerId: 'phone-1', sessionId: 'session-1', displayCode: '1회차',
    settings: { mode: 'COMMENT_TOUCH', prepareSeconds: 4, fallbackDelaySeconds: 0, printTarget },
    api: {
      run: async (...args) => state.runs.push(structuredClone(args)),
      call: async () => ({ mode: 'JWT', uniqueId: 'shop', jwtKey: 'fixture' }),
      claimCaptures: async () => ({ captures: [...pending] }),
      saveCapture: async () => { state.saves++; },
      claimPrints: async () => {
        state.claims++;
        const jobs = receipt ? [{ id: 'receipt-1', immutable_payload: { buyerNickname: '고객', amount: 17000 } }] : [];
        receipt = false;
        return { jobs, leaseToken: 'lease-1' };
      },
      print: async (kind, id, lease, result) => { if (kind === 'ACK') state.acks.push(result); },
      setPrintTarget: async (id, target) => {
        state.changes.push([id, target]);
        if (state.rejectSwitch) throw Object.assign(new Error('출력 중'), { code: 'PRINT_TARGET_BUSY' });
        return { ok: true, printTarget: target };
      },
    },
    printer: { connected: true, name: 'M50', send: async () => { state.sends++; } },
    serverOffset: () => 0, totals: () => ({ totalCount: 1, totalAmount: 17000 }),
    label: () => new Uint8Array([1]),
    capture: async () => { state.captures++; return 'data:image/jpeg;base64,AAAA'; },
    onComments: () => {}, onStatus: () => {}, onError: () => {}, onChange: () => {},
    socketFactory: () => ({ close() {} }),
  });
  return { producer, state, pending };
}

test('PC output keeps phone capture running and never claims or sends Bluetooth receipts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { producer, state } = fixture();
  try {
    await producer.start(); await settle();
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(1500); producer.wake(); await settle(); }
    assert.equal(state.runs[0][3].printTarget, 'PC_HELPER');
    assert.equal(state.claims, 0);
    assert.equal(state.sends, 0);
    assert.equal(state.captures, 1);
    assert.equal(state.saves, 1);
    assert.equal(producer.running, true);
  } finally { await producer.stop(); }
});

test('live target changes keep one phone run and capture generation while switching receipt output', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { producer, state } = fixture();
  try {
    await producer.start(); await settle();
    assert.equal(await producer.changePrintTarget('PHONE_BLUETOOTH'), 'PHONE_BLUETOOTH');
    await settle();
    assert.equal(state.sends, 1);
    assert.deepEqual(state.acks, ['SUCCESS']);
    await producer.changePrintTarget('PC_HELPER'); await settle();
    const before = state.claims;
    t.mock.timers.tick(10000); producer.wake(); await settle();
    assert.equal(state.claims, before);
    assert.equal(state.sends, 1);
    assert.equal(state.captures, 1);
    assert.equal(state.saves, 1);
    assert.equal(state.runs.filter(([kind]) => kind === 'START').length, 1);
    assert.equal(state.runs.some(([kind]) => kind === 'STOP'), false);
    assert.equal(state.runs.at(-1)[3].printTarget, 'PC_HELPER');
  } finally { await producer.stop(); }
});

test('a rejected target switch preserves PC routing and phone photography', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { producer, state, pending } = fixture();
  try {
    await producer.start(); await settle();
    state.rejectSwitch = true;
    await assert.rejects(producer.changePrintTarget('PHONE_BLUETOOTH'), { code: 'PRINT_TARGET_BUSY' });
    pending.push({ sale_id: 'sale-2', capture_generation: 'g2', capture_due_at: new Date().toISOString() });
    producer.wake(); await settle(); t.mock.timers.tick(1500); await settle();
    assert.equal(state.claims, 0);
    assert.equal(state.sends, 0);
    assert.equal(state.saves, 2);
    assert.equal(producer.running, true);
  } finally { await producer.stop(); }
});
