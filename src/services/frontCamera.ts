import { encodeCameraJpeg } from './cameraJpegEncoder.ts';

/** Sharpness = variance of a 4-neighbour Laplacian on grayscale; higher is sharper. */
export function frameSharpness(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++)
    gray[i] =
      rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        gray[i - 1] +
        gray[i + 1] +
        gray[i - width] +
        gray[i + width] -
        4 * gray[i];
      sum += lap;
      sq += lap * lap;
      n++;
    }
  if (!n) return 0;
  const mean = sum / n;
  return sq / n - mean * mean;
}

export function frameBrightness(rgba: Uint8Array | Uint8ClampedArray) {
  let total = 0;
  const px = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4)
    total += rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
  return px ? total / px : 0;
}

export async function startFrontCamera(
  video: HTMLVideoElement,
  idealWidth = 1280,
) {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error('이 브라우저는 카메라를 쓸 수 없습니다.');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: idealWidth },
      height: { ideal: Math.round((idealWidth * 3) / 4) },
    },
    audio: false,
  });
  try {
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    return stream;
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
    throw error;
  }
}

export type GrabbedFrame = {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  sharpness: number;
  brightness: number;
  candidates: number[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Takes `count` frames `gapMs` apart and keeps the sharpest (the saved photo is not mirrored). */
export async function grabSharpestFrame(
  video: HTMLVideoElement,
  options: {
    count?: number;
    gapMs?: number;
    maxWidth?: number;
    onPhase?: (phase: 'SAMPLING' | 'ENCODING') => void;
  } = {},
): Promise<GrabbedFrame> {
  const count = options.count ?? 3;
  const gapMs = options.gapMs ?? 150;
  const maxWidth = options.maxWidth ?? 1280;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error('카메라 화면이 아직 없습니다.');
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  const probe = document.createElement('canvas');
  probe.width = 160;
  probe.height = Math.round((160 * h) / w);
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  let best: { canvas: HTMLCanvasElement; score: number; light: number } | null =
    null;
  const scores: number[] = [];
  options.onPhase?.('SAMPLING');
  for (let i = 0; i < count; i++) {
    if (i) await sleep(gapMs);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
    pctx.drawImage(canvas, 0, 0, probe.width, probe.height);
    const data = pctx.getImageData(0, 0, probe.width, probe.height).data;
    const score = frameSharpness(data, probe.width, probe.height);
    scores.push(Math.round(score));
    if (!best || score > best.score)
      best = { canvas, score, light: frameBrightness(data) };
  }
  options.onPhase?.('ENCODING');
  const blob = await encodeCameraJpeg(best!.canvas, 0.85);
  return {
    blob,
    url: URL.createObjectURL(blob),
    width: w,
    height: h,
    sharpness: Math.round(best!.score),
    brightness: Math.round(best!.light),
    candidates: scores,
  };
}
