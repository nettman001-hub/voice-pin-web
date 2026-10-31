const JPEG_TYPE = 'image/jpeg';
const WORKER_TIMEOUT_MS = 2000;

/** Immediate compatibility path; HTMLCanvasElement.toBlob may wait for idle time. */
function encodeOnMainThread(canvas: HTMLCanvasElement, quality: number): Blob {
  const data = canvas.toDataURL(JPEG_TYPE, quality);
  const prefix = 'data:image/jpeg;base64,';
  if (!data.startsWith(prefix)) throw new Error('사진을 JPEG로 저장하지 못했습니다.');
  const binary = atob(data.slice(prefix.length));
  if (!binary.length) throw new Error('사진 저장 실패');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: JPEG_TYPE });
}

/** Encode off the UI thread, with a bounded fallback for older Android WebViews. */
export function encodeCameraJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' ||
      typeof createImageBitmap !== 'function') {
    return Promise.resolve().then(() => encodeOnMainThread(canvas, quality));
  }

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let worker: Worker | null = null;
    let ownedBitmap: ImageBitmap | null = null;
    const closeBitmap = (bitmap: ImageBitmap | null) => {
      try { bitmap?.close(); } catch { /* A transferred bitmap may already be detached. */ }
    };
    const finish = (blob?: Blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
      closeBitmap(ownedBitmap);
      ownedBitmap = null;
      try { resolve(blob || encodeOnMainThread(canvas, quality)); }
      catch (error) { reject(error); }
    };
    // Cover bitmap preparation as well as encoding, including a stalled worker.
    const timer = setTimeout(() => finish(), WORKER_TIMEOUT_MS);
    try {
      void createImageBitmap(canvas).then((bitmap) => {
        if (settled) {
          closeBitmap(bitmap);
          return;
        }
        ownedBitmap = bitmap;
        try {
          worker = new Worker(new URL('./cameraJpegEncoder.worker.ts', import.meta.url), { type: 'module' });
          worker.onmessage = (event: MessageEvent<{ blob?: Blob }>) => {
            const blob = event.data?.blob;
            finish(blob instanceof Blob && blob.type === JPEG_TYPE && blob.size ? blob : undefined);
          };
          worker.onerror = (event) => {
            event.preventDefault();
            finish();
          };
          worker.onmessageerror = () => finish();
          worker.postMessage({ bitmap, quality }, [bitmap]);
          ownedBitmap = null;
        } catch {
          finish();
        }
      }, () => finish());
    } catch {
      finish();
    }
  });
}
