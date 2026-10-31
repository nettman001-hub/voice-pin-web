import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/labelPrinter/phonePrinter.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { createPhonePrinter } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function nativeFixture(t, initial = {}) {
  const previous = globalThis.window;
  const window = new EventTarget();
  const state = { connected: false, saved: false, name: 'M50', ...initial };
  const calls = { picks: [], reconnects: [], sends: [] };
  window.VoiceCapAndroid = {
    printerState: () => JSON.stringify(state),
    printerPick: (id) => calls.picks.push(id),
    printerConnectLast: (id) => calls.reconnects.push(id),
    printerSend: (id, bytes) => calls.sends.push({ id, bytes }),
    printerDisconnect: () => { state.connected = false; },
  };
  globalThis.window = window;
  t.after(() => { globalThis.window = previous; });
  const reply = (requestId, ok, type = 'printer-connected') => {
    if (type === 'printer-connected' && ok) {
      state.connected = true;
      state.saved = true;
    }
    window.dispatchEvent(new CustomEvent('voicecap-android', {
      detail: JSON.stringify({ type, requestId, ok, error: ok ? undefined : '프린터 전원 꺼짐' }),
    }));
  };
  return { state, calls, reply };
}

test('a chosen native printer is remembered after recreating the web printer and reconnects without the picker', async (t) => {
  const fixture = nativeFixture(t);
  const first = createPhonePrinter();
  const choosing = first.connect();
  assert.equal(fixture.calls.picks.length, 1);
  fixture.reply(fixture.calls.picks[0], true);
  await choosing;
  assert.equal(first.saved, true);

  fixture.state.connected = false; // A later app session keeps native saved settings, not the live link.
  const restored = createPhonePrinter();
  const reconnecting = restored.reconnect();
  assert.equal(fixture.calls.reconnects.length, 1);
  fixture.reply(fixture.calls.reconnects[0], true);
  assert.equal(await reconnecting, true);
  assert.equal(restored.connected, true);
  assert.equal(restored.name, 'M50');
  assert.equal(fixture.calls.picks.length, 1, 'only the original selection opened a picker');
});

test('overlapping startup and sale-start reconnects share one native request and preserve an existing connection', async (t) => {
  const fixture = nativeFixture(t, { saved: true });
  const printer = createPhonePrinter();
  const first = printer.reconnect();
  const second = printer.reconnect();
  assert.equal(fixture.calls.reconnects.length, 1);
  fixture.reply(fixture.calls.reconnects[0], true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(await printer.reconnect(), true);
  assert.equal(fixture.calls.reconnects.length, 1, 'already connected printer must not disconnect and reconnect');
  assert.equal(fixture.calls.picks.length, 0);
});

test('first use does not launch an automatic picker, and a failed remembered connection can retry', async (t) => {
  const fixture = nativeFixture(t);
  const printer = createPhonePrinter();
  assert.equal(await printer.reconnect(), false);
  assert.equal(fixture.calls.reconnects.length, 0);
  assert.equal(fixture.calls.picks.length, 0);

  fixture.state.saved = true;
  const failed = printer.reconnect();
  fixture.reply(fixture.calls.reconnects[0], false);
  assert.equal(await failed, false);
  assert.equal(printer.connected, false);
  const retry = printer.reconnect();
  fixture.reply(fixture.calls.reconnects[1], true);
  assert.equal(await retry, true);
  assert.equal(fixture.calls.picks.length, 0);
});
