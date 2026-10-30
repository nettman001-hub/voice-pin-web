import assert from 'node:assert/strict';
import test from 'node:test';
import { reprintInApp, PRINTER_NOT_CONNECTED } from '../src/services/appReprint.ts';

const NOW = Date.parse('2026-10-30T05:00:00Z');
const running = { run: { running: true, lease_expires_at: '2026-10-30T05:00:20Z' }, serverNow: NOW };
const idle = { run: null, serverNow: NOW };
const sale = { id: 's1', buyerNickname: '꽃심이', amount: 10000, productName: '3번', touchSale: true, revision: 4 };

const makeDeps = (boot, printer = {}) => {
  const calls = { queued: [], sent: [], labels: [], reconnects: 0 };
  return {
    calls,
    deps: {
      bootstrap: async () => {
        if (boot instanceof Error) throw boot;
        return boot;
      },
      queueReprint: async (s) => void calls.queued.push(s.id),
      printer: {
        connected: true,
        reconnect: async () => {
          calls.reconnects += 1;
          return false;
        },
        send: async (d) => void calls.sent.push(d),
        ...printer,
      },
      label: (c) => {
        calls.labels.push(c);
        return new Uint8Array([1, 2, 3]);
      },
    },
  };
};

test('판매 중이면 서버 대기열에 넣고 이 탭은 출력하지 않는다', async () => {
  const { deps, calls } = makeDeps(running);
  assert.equal(await reprintInApp(sale, deps), 'QUEUED');
  assert.deepEqual(calls.queued, ['s1']);
  assert.equal(calls.sent.length, 0);
});

test('판매 중이 아니면 폰 프린터로 바로 출력한다(번호 라벨 포함)', async () => {
  const { deps, calls } = makeDeps(idle);
  assert.equal(await reprintInApp(sale, deps), 'PRINTED');
  assert.equal(calls.queued.length, 0);
  assert.equal(calls.sent.length, 1);
  assert.deepEqual(calls.labels[0], { buyer: '꽃심이', amount: 10000, productLabel: '3번' });
});

test('번호가 없는 상품은 번호 라벨 없이 출력한다', async () => {
  const { deps, calls } = makeDeps(idle);
  await reprintInApp({ ...sale, productName: '햇반' }, deps);
  assert.equal(calls.labels[0].productLabel, undefined);
});

test('프린터가 끊겨 있으면 한 번 다시 붙어 보고, 안 되면 연결 필요 오류', async () => {
  const { deps, calls } = makeDeps(idle, { connected: false });
  await assert.rejects(() => reprintInApp(sale, deps), (e) => e.code === PRINTER_NOT_CONNECTED);
  assert.equal(calls.reconnects, 1);
  assert.equal(calls.sent.length, 0);
});

test('다시 붙기에 성공하면 출력한다', async () => {
  const { deps, calls } = makeDeps(idle, { connected: false, reconnect: async () => true });
  assert.equal(await reprintInApp(sale, deps), 'PRINTED');
  assert.equal(calls.sent.length, 1);
});

test('판매 상태를 못 읽어도 직접 출력을 시도한다', async () => {
  const { deps, calls } = makeDeps(new Error('network'));
  assert.equal(await reprintInApp(sale, deps), 'PRINTED');
  assert.equal(calls.sent.length, 1);
});

test('터치 판매가 아니면 판매 중이어도 직접 출력한다', async () => {
  const { deps, calls } = makeDeps(running);
  assert.equal(await reprintInApp({ ...sale, touchSale: false }, deps), 'PRINTED');
  assert.equal(calls.queued.length, 0);
});

test('프린터 전송 오류는 그대로 올린다', async () => {
  const { deps } = makeDeps(idle, { send: async () => { throw new Error('전송 실패'); } });
  await assert.rejects(() => reprintInApp(sale, deps), /전송 실패/);
});

const withRecorder = (boot, printer, recorder) => {
  const made = makeDeps(boot, printer);
  made.calls.recorded = [];
  made.deps.recordPrint =
    recorder || (async (id, result) => void made.calls.recorded.push([id, result]));
  return made;
};

test('직접 출력에 성공하면 서버 기록에 성공으로 남긴다', async () => {
  const { deps, calls } = withRecorder(idle);
  assert.equal(await reprintInApp(sale, deps), 'PRINTED');
  assert.deepEqual(calls.recorded, [['s1', 'SUCCESS']]);
});

test('프린터 전송이 실패하면 실패로 남기고 오류는 그대로 올린다', async () => {
  const { deps, calls } = withRecorder(idle, { send: async () => { throw new Error('전송 실패'); } });
  await assert.rejects(() => reprintInApp(sale, deps), /전송 실패/);
  assert.deepEqual(calls.recorded, [['s1', 'FAILED']]);
});

test('프린터가 연결되지 않아 출력을 시도하지 못했으면 기록하지 않는다', async () => {
  const { deps, calls } = withRecorder(idle, { connected: false });
  await assert.rejects(() => reprintInApp(sale, deps), (e) => e.code === PRINTER_NOT_CONNECTED);
  assert.deepEqual(calls.recorded, []);
});

test('판매 중이라 대기열에 넣은 경우와 터치 판매가 아닌 경우는 기록하지 않는다', async () => {
  const queued = withRecorder(running);
  assert.equal(await reprintInApp(sale, queued.deps), 'QUEUED');
  assert.deepEqual(queued.calls.recorded, []);
  const plain = withRecorder(idle);
  assert.equal(await reprintInApp({ ...sale, touchSale: false }, plain.deps), 'PRINTED');
  assert.deepEqual(plain.calls.recorded, []);
});

test('서버 기록이 실패해도 출력 결과는 바뀌지 않는다', async () => {
  const failing = async () => { throw new Error('offline'); };
  const ok = withRecorder(idle, {}, failing);
  assert.equal(await reprintInApp(sale, ok.deps), 'PRINTED');
  const bad = withRecorder(idle, { send: async () => { throw new Error('전송 실패'); } }, failing);
  await assert.rejects(() => reprintInApp(sale, bad.deps), /전송 실패/);
});
