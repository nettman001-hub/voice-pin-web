type EncodeRequest = { bitmap: ImageBitmap; quality: number };
type EncodeReply = { blob: Blob } | { error: true };

const encoder = self as unknown as {
  onmessage: ((event: MessageEvent<EncodeRequest>) => void) | null;
  postMessage: (reply: EncodeReply) => void;
};

encoder.onmessage = async ({ data }) => {
  const bitmap = data.bitmap;
  let bitmapClosed = false;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context unavailable');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmapClosed = true;
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: data.quality });
    encoder.postMessage({ blob });
  } catch {
    encoder.postMessage({ error: true });
  } finally {
    if (!bitmapClosed) bitmap.close();
  }
};

export {};
