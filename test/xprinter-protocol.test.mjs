import test from 'node:test';
import assert from 'node:assert/strict';
import { xprinterPrintJob, xprinterCalibrate } from '../src/services/labelPrinter/xprinterProtocol.ts';
import { LABEL_PAPERS, normalizePaperSize, readPaperSize, savePaperSize } from '../src/services/labelPrinter/labelPaper.ts';

test('each supported stock controls TSPL size, raster bounds and calibration', () => {
  for (const [id, p] of Object.entries(LABEL_PAPERS)) {
    const bits = { rowBytes: p.widthPx / 8, height: p.heightPx, data: new Uint8Array(p.widthPx / 8 * p.heightPx) };
    const job = Buffer.from(xprinterPrintJob(bits, id));
    assert.ok(job.toString().startsWith(`SIZE ${p.widthMm} mm,${p.heightMm} mm\r\n`));
    assert.ok(job.includes(Buffer.from(`BITMAP 0,0,${bits.rowBytes},${bits.height},0,`)));
    assert.ok(Buffer.from(xprinterCalibrate(id)).toString().startsWith(`SIZE ${p.widthMm} mm,${p.heightMm} mm\r\n`));
    assert.throws(() => xprinterPrintJob({ ...bits, rowBytes: bits.rowBytes + 1 }, id), /크기/);
    assert.throws(() => xprinterPrintJob({ ...bits, height: bits.height + 1 }, id), /크기/);
  }
});

test('stock persists per workspace, model and device, with legacy 50x30 fallback', (t) => {
  const previous = globalThis.localStorage;
  const saved = new Map();
  globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  t.after(() => { globalThis.localStorage = previous; });
  const p = { model: 'XP_237BT', deviceId: 'AA', name: 'XP' };
  assert.equal(readPaperSize('w', p), '50x30');
  savePaperSize('w', p, '40x25');
  assert.equal(readPaperSize('w', { ...p }), '40x25');
  assert.equal(readPaperSize('other', p), '50x30');
  assert.equal(readPaperSize('w', { ...p, deviceId: 'BB' }), '50x30');
  assert.equal(readPaperSize('w', { ...p, model: 'M50' }), '50x30');
  savePaperSize('w', p, '40x30');
  assert.equal(readPaperSize('w', p), '40x30');
  assert.equal(normalizePaperSize('__proto__'), '50x30');
});

test('XP TSPL job preserves binary length, inverts MSB black bits, and prints one label', () => {
  const data = Uint8Array.of(0x80, 0x01, 0xff, 0x00);
  const job = xprinterPrintJob({ rowBytes: 2, height: 2, data });
  const header = Buffer.from(job).indexOf('BITMAP 0,0,2,2,0,') + 'BITMAP 0,0,2,2,0,'.length;
  assert.deepEqual([...job.subarray(header, header + 4)], [0x7f, 0xfe, 0x00, 0xff]);
  assert.equal(Buffer.from(job.subarray(header + 4)).toString(), '\r\nPRINT 1,1\r\n');
  assert.match(Buffer.from(job).toString(), /^SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm\r\n/);
  assert.deepEqual([...data], [0x80, 0x01, 0xff, 0x00], 'shared bitmap must not be mutated');
});

test('XP rejects overflow and truncated bitmaps before sending binary data', () => {
  for (const bitmap of [
    { rowBytes: 49, height: 1, data: new Uint8Array(49) },
    { rowBytes: 48, height: 241, data: new Uint8Array(48 * 241) },
    { rowBytes: 48, height: 240, data: new Uint8Array(1) },
  ]) assert.throws(() => xprinterPrintJob(bitmap), /크기/);
  const full = xprinterPrintJob({ rowBytes: 48, height: 240, data: new Uint8Array(48 * 240) });
  assert.match(Buffer.from(full).toString(), /BITMAP 0,0,48,240,0,/);
});

test('XP calibration uses TSPL gap detection without a print command', () => {
  assert.equal(Buffer.from(xprinterCalibrate()).toString(), 'SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm\r\nGAPDETECT\r\n');
});
