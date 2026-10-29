/**
 * "VoiceCAP 판매" 안드로이드 앱(:sales)의 WebView 다리.
 * 앱이 window.VoiceCapAndroid(문자열만 주고받음)를 넣고, 결과는 window 'voicecap-android' 이벤트로 돌려준다.
 * 웹이 라벨을 그리고 명령 바이트를 만들며, 앱은 블루투스로 바이트만 보낸다.
 */
export type AndroidNative = {
  info(): string;
  printerState(): string;
  printerPick(requestId: string): void;
  printerConnectLast(requestId: string): void;
  printerSend(requestId: string, base64: string): void;
  printerDisconnect(): void;
  saveFile(requestId: string, fileName: string, mime: string, base64: string): void;
  shareFile(fileName: string, mime: string, base64: string): void;
  selling(on: boolean): void;
};
export type AndroidEvent = {
  type: string;
  requestId?: string;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

export const androidNative = (): AndroidNative | null =>
  typeof window !== 'undefined'
    ? ((window as unknown as { VoiceCapAndroid?: AndroidNative }).VoiceCapAndroid ?? null)
    : null;

export const isSalesApp = () => !!androidNative();

export function androidJson<T>(raw: string | undefined | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 요청 하나의 결과 이벤트를 기다린다. */
export function waitAndroid(
  type: string,
  requestId: string,
  timeoutMs: number,
): Promise<AndroidEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('voicecap-android', listener as EventListener);
      reject(new Error('앱 응답이 없습니다. 앱을 다시 열어 주세요.'));
    }, timeoutMs);
    const listener = (e: CustomEvent<AndroidEvent | string>) => {
      const detail =
        typeof e.detail === 'string' ? androidJson<AndroidEvent>(e.detail, { type: '' }) : e.detail;
      if (detail?.type !== type || detail.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('voicecap-android', listener as EventListener);
      if (detail.ok === false) reject(new Error(detail.error || '앱에서 처리하지 못했습니다.'));
      else resolve(detail);
    };
    window.addEventListener('voicecap-android', listener as EventListener);
  });
}

export function bytesToBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function textToBase64(text: string) {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** CSV 파일: 판매 앱이면 다운로드 폴더에 저장, 브라우저면 내려받기. */
export async function saveTextFile(fileName: string, mime: string, text: string) {
  const native = androidNative();
  if (native) {
    const requestId = crypto.randomUUID();
    const wait = waitAndroid('file-saved', requestId, 20000);
    native.saveFile(requestId, fileName, mime, textToBase64(text));
    return wait;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { type: 'file-saved', ok: true } as AndroidEvent;
}

export function shareTextFile(fileName: string, mime: string, text: string) {
  const native = androidNative();
  if (native) native.shareFile(fileName, mime, textToBase64(text));
  else if ('share' in navigator)
    void (navigator as Navigator).share({
      files: [new File([text], fileName, { type: mime })],
    }).catch(() => {});
}
