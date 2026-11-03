/**
 * 폰의 PC 댓글도우미 연결 토큰 보관. 앱을 껐다 켜도 다시 승인하지 않게 기억한다.
 * - 판매 앱(1.0.7+): Android Keystore로 암호화해 앱 저장소에 둔다.
 * - 그 밖(옛 판매 앱·브라우저): 이 기기의 로그인 정보와 같은 곳(localStorage)에 둔다.
 *   옛 앱에서 저장한 값은 새 앱(Keystore)이 처음 읽을 때 옮기고 지운다.
 * 토큰을 URL·판매 설정(JSON)에는 넣지 않는다. 연결 해제하면 지운다.
 */
import { androidJson, androidNative } from './labelPrinter/androidBridge';

const memory = new Map<string, string>();
const localKey = (workspaceId: string) => `voicecap-helper-link:${workspaceId}`;

function localGet(workspaceId: string) {
  try {
    return localStorage.getItem(localKey(workspaceId)) || null;
  } catch {
    return memory.get(workspaceId) || null;
  }
}
function localSet(workspaceId: string, token: string) {
  memory.set(workspaceId, token);
  try {
    localStorage.setItem(localKey(workspaceId), token);
  } catch {}
}
function localClear(workspaceId: string) {
  memory.delete(workspaceId);
  try {
    localStorage.removeItem(localKey(workspaceId));
  } catch {}
}

/** Keystore에 암호화해 보관하는 판매 앱인지. */
export function helperLinkSecure() {
  const a = androidNative();
  return !!(a?.helperLinkGet && a.helperLinkSet && a.helperLinkClear);
}

export function readHelperLink(workspaceId: string): string | null {
  const a = androidNative();
  if (a?.helperLinkGet) {
    let token: string | null = null;
    try {
      token = a.helperLinkGet(workspaceId) || null;
    } catch {
      token = null;
    }
    if (token) return token;
    // 옛 앱에서 기억해 둔 연결을 새 앱 보관함으로 옮긴다.
    const old = localGet(workspaceId);
    if (old) {
      try {
        if (a.helperLinkSet?.(workspaceId, old)) localClear(workspaceId);
      } catch {}
      return old;
    }
    return memory.get(workspaceId) || null;
  }
  return localGet(workspaceId) || memory.get(workspaceId) || null;
}

export function saveHelperLink(workspaceId: string, token: string) {
  const a = androidNative();
  if (a?.helperLinkSet) {
    try {
      if (a.helperLinkSet(workspaceId, token)) return true;
    } catch {}
    return false;
  }
  localSet(workspaceId, token);
  return true;
}

export function clearHelperLink(workspaceId: string) {
  const a = androidNative();
  try {
    a?.helperLinkClear?.(workspaceId);
  } catch {}
  localClear(workspaceId);
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
