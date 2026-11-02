/**
 * 폰의 PC 댓글도우미 연결 토큰 보관.
 * - 판매 앱(1.0.5+): Android Keystore로 암호화해 앱 저장소에 둔다.
 * - 그 밖(브라우저·옛 앱): 이 탭 메모리에만 둔다. 새로고침하면 PC에서 다시 승인해야 한다.
 * 토큰을 localStorage·URL·판매 설정(JSON)에 넣지 않는다.
 */
import { androidJson, androidNative } from './labelPrinter/androidBridge';

const memory = new Map<string, string>();

export function helperLinkSecure() {
  const a = androidNative();
  return !!(a?.helperLinkGet && a.helperLinkSet && a.helperLinkClear);
}

export function readHelperLink(workspaceId: string): string | null {
  const a = androidNative();
  if (a?.helperLinkGet) {
    try {
      return a.helperLinkGet(workspaceId) || null;
    } catch {
      return null;
    }
  }
  return memory.get(workspaceId) || null;
}

export function saveHelperLink(workspaceId: string, token: string) {
  const a = androidNative();
  if (a?.helperLinkSet) {
    try {
      if (a.helperLinkSet(workspaceId, token)) return true;
    } catch {}
    return false;
  }
  memory.set(workspaceId, token);
  return true;
}

export function clearHelperLink(workspaceId: string) {
  const a = androidNative();
  try {
    a?.helperLinkClear?.(workspaceId);
  } catch {}
  memory.delete(workspaceId);
}

const INSTALL_KEY = 'voicecap-phone-install-id';

/** 이 설치(앱)를 구분하는 값과 폰 이름. 비밀 아님. */
export function phoneIdentity(): { installId: string; name: string } {
  const a = androidNative();
  if (a?.helperDeviceInfo) {
    const info = androidJson<{ installId?: string; name?: string }>(a.helperDeviceInfo(), {});
    if (info.installId) return { installId: info.installId, name: info.name || 'Android' };
  }
  let id = '';
  try {
    id = localStorage.getItem(INSTALL_KEY) || '';
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(INSTALL_KEY, id);
    }
  } catch {
    id = crypto.randomUUID();
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const model = /Android [^;]+; ([^)]+)\)/.exec(ua)?.[1]?.split(' Build')[0];
  return { installId: id, name: model || '웹 브라우저' };
}
