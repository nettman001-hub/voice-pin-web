import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import {
  LABEL_HEIGHT_PX,
  LABEL_WIDTH_PX,
  PAPER_CONTINUOUS,
  adler32,
  bitmapCommand,
  buildPrintJob,
  chunkBytes,
  marklifeCommands,
  packBitmap,
  parseCredit,
  zlibStored,
} from '../src/services/labelPrinter/marklifeProtocol.ts';
import { frameSharpness } from '../src/services/frontCamera.ts';

const rgba = (w, h, isBlack) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = isBlack(x, y) ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return data;
};

test('label size is 50x30 mm at 203 dpi', () => {
  assert.equal(LABEL_WIDTH_PX, 384);
  assert.equal(LABEL_HEIGHT_PX, 240);
});

test('bitmap packs MSB-first, black = 1, transparent stays white', () => {
  const data = rgba(10, 2, (x, y) => (y === 0 ? x === 0 || x === 9 : x === 1));
  data[(1 * 10 + 1) * 4 + 3] = 0; // transparent black pixel
  const bits = packBitmap(data, 10, 2);
  assert.equal(bits.rowBytes, 2);
  assert.deepEqual([...bits.data], [0x80, 0x40, 0x00, 0x00]);
});

test('zlib stored stream inflates back, with a 1 KB window too', () => {
  const big = new Uint8Array(150000).map((_, i) => (i * 7) & 0xff);
  for (const data of [new Uint8Array(0), Uint8Array.of(1, 2, 3), big]) {
    const z = zlibStored(data);
    assert.equal(z[0], 0x28);
    assert.equal(((z[0] << 8) | z[1]) % 31, 0);
    assert.deepEqual(new Uint8Array(inflateSync(z)), data);
    assert.deepEqual(new Uint8Array(inflateSync(z, { windowBits: 10 })), data);
  }
  assert.equal(adler32(new TextEncoder().encode('Wikipedia')), 0x11e60398);
});

test('bitmap command header: 1F 10, row bytes, rows, length', () => {
  const bits = packBitmap(
    rgba(384, 240, (x) => x < 8),
    384,
    240,
  );
  const cmd = bitmapCommand(bits);
  assert.deepEqual([...cmd.subarray(0, 6)], [0x1f, 0x10, 0, 48, 0, 240]);
  const len = (cmd[6] << 24) | (cmd[7] << 16) | (cmd[8] << 8) | cmd[9];
  assert.equal(len, cmd.length - 10);
  const raw = new Uint8Array(inflateSync(cmd.subarray(10)));
  assert.equal(raw.length, 48 * 240);
  assert.equal(raw[0], 0xff);
  assert.equal(raw[1], 0x00);
});

test('print job: settings, then start, align, image, stop, feed per copy', () => {
  const bits = packBitmap(
    rgba(16, 2, () => true),
    16,
    2,
  );
  const job = buildPrintJob(bits, {
    paper: PAPER_CONTINUOUS,
    density: 20,
    speed: 9,
    copies: 2,
  });
  const hex = Buffer.from(job).toString('hex');
  assert.ok(hex.startsWith('1f800110' + '1f70010f' + '1f600102'));
  const image = Buffer.from(bitmapCommand(bits)).toString('hex');
  const one = '1fc00100' + '1f1151' + image + '1fc00101' + '1f1150';
  assert.equal(hex, '1f800110' + '1f70010f' + '1f600102' + one + one);
  assert.deepEqual([...marklifeCommands.selfTest()], [0x1f, 0x40]);
});

test('chunks are 90 bytes and credits read as [01, n]', () => {
  const chunks = chunkBytes(new Uint8Array(200));
  assert.deepEqual(
    chunks.map((c) => c.length),
    [90, 90, 20],
  );
  assert.equal(parseCredit(Uint8Array.of(0x01, 0x0a)), 10);
  assert.equal(parseCredit(Uint8Array.of(0x02, 0x0a)), null);
  assert.equal(parseCredit(Uint8Array.of(0x01)), null);
});

test('sharper frames score higher', () => {
  const sharp = rgba(40, 40, (x) => x % 4 < 2);
  const flat = rgba(40, 40, () => false);
  const blur = new Uint8ClampedArray(sharp);
  for (let i = 0; i < blur.length; i += 4)
    if (blur[i] === 0) blur[i] = blur[i + 1] = blur[i + 2] = 120;
  assert.ok(frameSharpness(sharp, 40, 40) > frameSharpness(blur, 40, 40));
  assert.ok(frameSharpness(blur, 40, 40) > frameSharpness(flat, 40, 40));
  assert.equal(frameSharpness(flat, 40, 40), 0);
});
