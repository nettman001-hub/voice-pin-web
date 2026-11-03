/**
 * "새 관리 화면 사용" 켜기·끄기 (이 기기·이 계정에만 저장).
 * 출시 멈춤 조건이 생기면 끄고 옛 화면으로 돌아간다. 처음 값은 꺼짐 (화면이 다 만들어질 때까지).
 */

const KEY = 'voicecap_new_manage_ui';
export const MANAGE_UI_EVENT = 'voicecap-manage-ui-change';

const storageKey = (workspaceId?: string | null) => (workspaceId ? `${KEY}_${workspaceId}` : KEY);

export function isNewManageUiEnabled(workspaceId?: string | null, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(storageKey(workspaceId)) === 'on';
  } catch {
    return false;
  }
}

export function setNewManageUiEnabled(workspaceId: string | null | undefined, enabled: boolean,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(storageKey(workspaceId), enabled ? 'on' : 'off');
  } catch {
    // 저장이 막힌 브라우저에서는 이번 화면에서만 바뀐다.
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(MANAGE_UI_EVENT, { detail: { workspaceId, enabled } }));
  } catch {
    // 테스트 환경
  }
}
