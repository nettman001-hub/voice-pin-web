/**
 * Marklife-family BLE label printer bytes (AbleMark M50 mini is the phase-0 test printer).
 * Written from the protocol facts only (command values, bitmap header, zlib with a
 * 1 KB window); no vendor code is copied. Every value here is unconfirmed on the
 * M50 until the phase-0 test print, so the test page exposes the options.
 */

export const LABEL_WIDTH_PX = 384; // 48 mm at 203 dpi
export const LABEL_HEIGHT_PX = 240; // 30 mm at 203 dpi

export const PAPER_GAP = 0x20;
export const PAPER_CONTINUOUS = 0x10;

export const marklifeCommands = {
  start: () => bytes(0x1f, 0xc0, 0x01, 0x00),
  stop: () => bytes(0x1f, 0xc0, 0x01, 0x01),
  btType: () => bytes(0x1f, 0xb2, 0x00),
  paperType: (type: number) => bytes(0x1f, 0x80, 0x01, type),
  density: (level: number) =>
    bytes(0x1f, 0x70, 0x01, clamp(Math.round(level), 1, 15)),
  speed: (level: number) =>
    bytes(0x1f, 0x60, 0x01, clamp(Math.round(level), 0, 2)),
  alignStart: () => bytes(0x1f, 0x11, 0x51),
  alignEnd: () => bytes(0x1f, 0x11, 0x50),
  findGap: () => bytes(0x1f, 0x12, 0x20, 0x00),
  feedDots: (dots: number) => {
    const n = clamp(Math.round(dots), 0, 0xffff);
    return bytes(0x1f, 0x11, 0x00, n >> 8, n & 0xff);
  },
  selfTest: () => bytes(0x1f, 0x40),
  learnPaper: () => bytes(0x1f, 0x30, 0x60),
  status: () => bytes(0x1f, 0x20, 0x00),
  battery: () => bytes(0x10, 0xff, 0x50, 0xf1),
  version: () => bytes(0x10, 0xff, 0x20, 0xf1),
  model: () => bytes(0x10, 0xff, 0x20, 0xf0),
};

function bytes(...values: number[]) {
  return Uint8Array.from(values);
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

/** RGBA pixels to 1-bit rows, MSB = leftmost pixel, 1 = black. Transparent pixels stay white. */
export function packBitmap(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 160,
) {
  const rowBytes = Math.ceil(width / 8);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] === 0) continue;
      const gray =
        (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
      if (gray < threshold) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { rowBytes, height, data: out };
}

export function adler32(data: Uint8Array) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * zlib stream made of stored (uncompressed) deflate blocks. Any inflater accepts it
 * whatever its window size, which matters because the printer's window is 1 KB.
 */
export function zlibStored(data: Uint8Array) {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  out[0] = 0x28; // deflate, 1 KB window
  out[1] = 31 - ((0x28 * 256) % 31); // header check, no dictionary, fastest level
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, data.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = len >> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >> 8) & 0xff;
    out.set(data.subarray(start, start + len), o);
    o += len;
  }
  const sum = adler32(data);
  out[o++] = sum >>> 24;
  out[o++] = (sum >>> 16) & 0xff;
  out[o++] = (sum >>> 8) & 0xff;
  out[o++] = sum & 0xff;
  return out;
}

/** 1F 10, row bytes (2), rows (2), compressed length (4), then the zlib data. */
export function bitmapCommand(bitmap: {
  rowBytes: number;
  height: number;
  data: Uint8Array;
}) {
  const z = zlibStored(bitmap.data);
  const out = new Uint8Array(10 + z.length);
  out[0] = 0x1f;
  out[1] = 0x10;
  out[2] = bitmap.rowBytes >> 8;
  out[3] = bitmap.rowBytes & 0xff;
  out[4] = bitmap.height >> 8;
  out[5] = bitmap.height & 0xff;
  out[6] = z.length >>> 24;
  out[7] = (z.length >>> 16) & 0xff;
  out[8] = (z.length >>> 8) & 0xff;
  out[9] = z.length & 0xff;
  out.set(z, 10);
  return out;
}

export const DOTS_PER_MM = 8; // 203 dpi

/**
 * How each label ends. AUTO = align start/end commands only; on the M50 (2026-10-29)
 * this printed labels back to back, ignoring the gap. GAP = ask the printer to find
 * the next gap. FIXED = feed the rest of the label pitch (label + gap length).
 */
export type LabelAlign = 'AUTO' | 'GAP' | 'FIXED';

export type PrintJobOptions = {
  paper?: number;
  density?: number;
  speed?: number;
  copies?: number;
  align?: LabelAlign;
  pitchMm?: number;
};

export function labelTail(
  imageRows: number,
  align: LabelAlign = 'AUTO',
  pitchMm = 38,
) {
  if (align === 'GAP') return [marklifeCommands.findGap()];
  if (align === 'FIXED')
    return [
      marklifeCommands.feedDots(
        Math.max(0, Math.round(pitchMm * DOTS_PER_MM) - imageRows),
      ),
    ];
  return [marklifeCommands.alignEnd()];
}

export function buildPrintJob(
  bitmap: { rowBytes: number; height: number; data: Uint8Array },
  options: PrintJobOptions = {},
) {
  const parts: Uint8Array[] = [
    marklifeCommands.paperType(options.paper ?? PAPER_GAP),
    marklifeCommands.density(options.density ?? 3),
    marklifeCommands.speed(options.speed ?? 1),
  ];
  const image = bitmapCommand(bitmap);
  const copies = clamp(Math.round(options.copies ?? 1), 1, 5);
  for (let i = 0; i < copies; i++)
    parts.push(
      marklifeCommands.start(),
      marklifeCommands.alignStart(),
      image,
      marklifeCommands.stop(),
      ...labelTail(bitmap.height, options.align, options.pitchMm),
    );
  return concatBytes(parts);
}

export function concatBytes(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function chunkBytes(data: Uint8Array, size = 90) {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size)
    chunks.push(data.subarray(i, i + size));
  return chunks;
}

export const toHex = (data: Uint8Array | DataView, max = 32) => {
  const view =
    data instanceof DataView
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : data;
  const hex = Array.from(view.subarray(0, max), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join(' ');
  return view.length > max ? `${hex} …(${view.length}B)` : hex;
};

/**
 * Credit notifications on FF03 are unconfirmed. Most Marklife-family firmware sends
 * [0x01, n] = n more packets allowed; anything else is logged and ignored.
 */
export function parseCredit(value: Uint8Array) {
  if (value.length >= 2 && value[0] === 0x01) return value[1];
  return null;
}
