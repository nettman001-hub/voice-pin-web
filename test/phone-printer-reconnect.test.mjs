import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/labelPrinter/phonePrinter.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { createPhonePrinter, initializePrinterBytes, realignBytes, printerCalibrationKey, saleLabelBytes } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

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

test('XP model and device restore from native state and use the model-aware picker', async (t) => {
  const f = nativeFixture(t, { model: 'XP_237BT', address: 'AA:BB', name: 'XP-237BT', saved: true });
  let selected;
  window.VoiceCapAndroid.printerPickV2 = (id) => { selected = id; };
  const p = createPhonePrinter();
  assert.equal(p.model, 'XP_237BT');
  assert.equal(p.deviceId, 'AA:BB');
  const picking = p.connect();
  f.reply(selected, true);
  await picking;
  assert.equal(f.calls.picks.length, 0);
  assert.equal(createPhonePrinter().model, 'XP_237BT');
  assert.equal(initializePrinterBytes(p.model).length, 0);
  assert.match(Buffer.from(realignBytes(p.model)).toString(), /GAPDETECT/);
  assert.notEqual(printerCalibrationKey('w', p), printerCalibrationKey('w', { name: 'M50', model: 'M50', deviceId: 'AA:BB' }));
  assert.notEqual(printerCalibrationKey('w', p), printerCalibrationKey('w', { name: 'XP', model: 'XP_237BT', deviceId: 'CC:DD' }));
});

test('the shared sale renderer routes XP and legacy M50 to different encoders', () => {
  const ctx = {
    fillRect() {}, fillText() {}, measureText() { return { width: 10 }; },
    getImageData() { return { data: new Uint8ClampedArray(384 * 240 * 4).fill(255), width: 384, height: 240 }; },
  };
  const canvas = { getContext: () => ctx };
  const content = { buyer: '한글', amount: 10000, productLabel: '1번' };
  assert.equal(Buffer.from(saleLabelBytes(content, canvas, {}, 'XP_237BT').subarray(0, 5)).toString(), 'SIZE ');
  assert.equal(saleLabelBytes(content, canvas)[0], 0x1f);
});

test('both encoders use the chosen stock dimensions and scaled layout', () => {
  for (const [paperSize, width, height] of [['50x30', 384, 240], ['40x25', 320, 200], ['40x30', 320, 240]]) {
    const text = [];
    const canvas = { getContext: () => ctx };
    const ctx = {
      fillRect() {}, fillText(...args) { text.push(args); }, measureText() { return { width: 10 }; },
      getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255), width: canvas.width, height: canvas.height }; },
    };
    for (const model of ['M50', 'XP_237BT']) {
      const bytes = saleLabelBytes({ buyer: '긴 한글 이름', amount: 1234567, productLabel: '123번' }, canvas, { paperSize }, model);
      assert.equal(canvas.width, width);
      assert.equal(canvas.height, height);
      if (model === 'XP_237BT') assert.ok(Buffer.from(bytes).includes(Buffer.from(`BITMAP 0,0,${width / 8},${height},0,`)));
      else {
        const image = Buffer.from(bytes).indexOf(Buffer.from([0x1f, 0x10]));
        assert.equal((bytes[image + 2] << 8) | bytes[image + 3], width / 8);
        assert.equal((bytes[image + 4] << 8) | bytes[image + 5], height);
      }
      assert.ok(text.every(([, x, y, maxWidth]) => x < width && y < height && maxWidth <= width));
    }
  }
});

test('a chosen native printer is remembered after recreating the web printer and reconnects without the picker', async (t) => {
  const fixture = nativeFixture(t);
  const first = createPhonePrinter();
  assert.equal(first.model, 'M50', 'older native apps without model metadata retain M50');
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
