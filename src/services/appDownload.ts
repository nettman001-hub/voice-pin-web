import { androidNative, bytesToBase64, waitAndroid } from './labelPrinter/androidBridge.ts';

/** 판매 앱 화면에 잠깐 뜨는 알림. 앱의 WebView는 alert()를 보여 주지 않아 직접 그린다. */
export type AppToastDetail = { message: string; actionLabel?: string; onAction?: () => void };
export const APP_TOAST_EVENT = 'voicecap-app-toast';

export function appToast(detail: AppToastDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppToastDetail>(APP_TOAST_EVENT, { detail }));
}

/**
 * 판매 앱이면 파일을 폰 다운로드 폴더(Download/VoiceCAP)에 저장하고 알림을 띄운다. 앱이 아니면 false를 돌려 주니
 * 부른 쪽이 기존 브라우저 다운로드를 한다.
 */
export async function saveFileInApp(fileName: string, mime: string, data: Blob | string): Promise<boolean> {
  const native = androidNative();
  if (!native) return false;
  try {
    const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const requestId = crypto.randomUUID();
    const wait = waitAndroid('file-saved', requestId, 30000);
    native.saveFile(requestId, fileName, mime, base64);
    await wait;
    appToast({
      message: `다운로드 폴더(VoiceCAP)에 저장했습니다: ${fileName}`,
      actionLabel: '공유',
      onAction: () => native.shareFile(fileName, mime, base64),
    });
  } catch (error) {
    appToast({ message: `저장하지 못했습니다: ${(error as Error).message || '알 수 없는 오류'}` });
  }
  return true;
}

/** 사진 주소(data: 또는 https:)를 받아 앱에 저장한다. 받지 못하면 알림만 띄운다. */
export async function saveUrlInApp(fileName: string, url: string): Promise<boolean> {
  if (!androidNative()) return false;
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    // 오류 응답(403·404·500)이나 사진이 아닌 본문(오류 HTML 등)을 사진 파일로 저장하지 않는다.
    if (!response.ok || (blob.type && !blob.type.startsWith('image/'))) throw new Error(`HTTP ${response.status}`);
    return await saveFileInApp(fileName, blob.type || 'image/png', blob);
  } catch {
    appToast({ message: '사진을 받지 못했습니다. 연결을 확인하고 다시 시도해 주세요.' });
    return true;
  }
}
