import assert from 'node:assert/strict';
import test from 'node:test';
import { reprintInApp, PRINTER_NOT_CONNECTED, SELLING_STATE_UNKNOWN } from '../src/services/appReprint.ts';

const NOW = Date.parse('2026-10-30T05:00:00Z');
const running = { run: { running: true, lease_expires_at: '2026-10-30T05:00:20Z' }, serverNow: NOW };
const idle = { run: null, serverNow: NOW };
const sale = { id: 's1', buyerNickname: '꽃심이', amount: 10000, productName: '3번', touchSale: true, revision: 4 };
const ticket = (over = {}) => ({ jobId: 'j1', leaseToken: 't1', sale: { buyerNickname: '꽃심이', amount: 10000, productName: '3번', ...over } });

const makeDeps = (boot, { printer = {}, begin, finish } = {}) => {
  const calls = { order: [], queued: [], sent: [], labels: [], reconnects: 0, begun: [], finished: [] };
  return {
    calls,
    deps: {
      bootstrap: async () => {
        calls.order.push('bootstrap');
        if (boot instanceof Error) throw boot;
        return boot;
      },
      queueReprint: async (s) => {
        calls.order.push('queue');
        calls.queued.push(s.id);
      },
      beginDirect: async (s) => {
        calls.order.push('begin');
        calls.begun.push([s.id, s.revision]);
        if (begin instanceof Error) throw begin;
        return begin || ticket();
      },
      finishDirect: async (t, result) => {
        calls.order.push('finish');
        calls.finished.push([t.jobId, result]);
        if (finish) return finish(calls.finished.length);
      },
      printer: {
        connected: true,
        connect: async () => void calls.order.push('connect'),
        reconnect: async () => {
          calls.reconnects += 1;
          return false;
        },
        send: async (d) => {
          calls.order.push('send');
          calls.sent.push(d);
        },
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
  assert.equal(calls.begun.length, 0);
});

test('판매 중이 아니면 서버에서 자리를 잡은 뒤 서버의 최신 내용으로 출력하고 결과를 남긴다', async () => {
  const { deps, calls } = makeDeps(idle, { begin: ticket({ amount: 12000 }) });
  assert.equal(await reprintInApp(sale, deps), 'PRINTED');
  assert.deepEqual(calls.order, ['bootstrap', 'begin', 'send', 'finish']);
  assert.deepEqual(calls.begun, [['s1', 4]]);
  assert.deepEqual(calls.labels[0], { buyer: '꽃심이', amount: 12000, productLabel: '3번' }, '화면의 낡은 금액이 아니라 서버 금액');
  assert.deepEqual(calls.finished, [['j1', 'SUCCESS']]);
});

test('서버가 거절하면(대기 전표, 취소, 수정) 종이를 내지 않는다', async () => {
  const pending = Object.assign(new Error('아직 처리 중인 전표가 있습니다.'), { code: 'PRINT_ALREADY_PENDING' });
  const { deps, calls } = makeDeps(idle, { begin: pending });
  await assert.rejects(() => reprintInApp(sale, deps), /처리 중인 전표/);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.finished.length, 0);
});

test('판매 상태를 못 읽으면 직접 출력하지 않는다', async () => {
  const { deps, calls } = makeDeps(new Error('network'));
  await assert.rejects(() => reprintInApp(sale, deps), (e) => e.code === SELLING_STATE_UNKNOWN);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.begun.length, 0);
});

test('프린터 연결 후 출력: 판매 상태를 먼저 보고, 판매 중이면 프린터를 건드리지 않고 대기열로 보낸다', async () => {
  const { deps, calls } = makeDeps(running);
  assert.equal(await reprintInApp(sale, deps, { connectFirst: true }), 'QUEUED');
  assert.deepEqual(calls.order, ['bootstrap', 'queue']);
  const idleRun = makeDeps(idle);
  assert.equal(await reprintInApp(sale, idleRun.deps, { connectFirst: true }), 'PRINTED');
  assert.deepEqual(idleRun.calls.order, ['bootstrap', 'connect', 'begin', 'send', 'finish']);
});

test('프린터가 끊겨 있으면 한 번 다시 붙어 보고, 안 되면 연결 필요 오류(서버 자리는 잡지 않는다)', async () => {
  const { deps, calls } = makeDeps(idle, { printer: { connected: false } });
  await assert.rejects(() => reprintInApp(sale, deps), (e) => e.code === PRINTER_NOT_CONNECTED);
  assert.equal(calls.reconnects, 1);
  assert.equal(calls.begun.length, 0);
});

test('다시 붙기에 성공하면 출력한다', async () => {
  const { deps, calls } = makeDeps(idle, { printer: { connected: false, reconnect: async () => true } });
  assert.equal(await reprintInApp(sale, deps), 'PRINTED');
  assert.equal(calls.sent.length, 1);
});

test('번호가 없는 상품은 번호 라벨 없이 출력한다', async () => {
  const { deps, calls } = makeDeps(idle, { begin: ticket({ productName: '햇반' }) });
  await reprintInApp(sale, deps);
  assert.equal(calls.labels[0].productLabel, undefined);
});

test('터치 판매가 아니면 판매 상태·서버 자리 없이 화면 내용으로 바로 출력한다', async () => {
  const { deps, calls } = makeDeps(running);
  assert.equal(await reprintInApp({ ...sale, touchSale: false }, deps), 'PRINTED');
  assert.deepEqual(calls.order, ['send']);
});

test('프린터 전송이 실패하면 실패로 남기고 오류는 그대로 올린다', async () => {
  const { deps, calls } = makeDeps(idle, { printer: { send: async () => { throw new Error('전송 실패'); } } });
  await assert.rejects(() => reprintInApp(sale, deps), /전송 실패/);
  assert.deepEqual(calls.finished, [['j1', 'FAILED']]);
});

test('결과 기록은 한 번 다시 시도하고, 그래도 안 되면 "기록 못 함"으로 알린다', async () => {
  const flaky = makeDeps(idle, { finish: (n) => { if (n === 1) throw new Error('offline'); } });
  assert.equal(await reprintInApp(sale, flaky.deps), 'PRINTED');
  assert.equal(flaky.calls.finished.length, 2);
  const down = makeDeps(idle, { finish: () => { throw new Error('offline'); } });
  assert.equal(await reprintInApp(sale, down.deps), 'PRINTED_UNRECORDED');
});
