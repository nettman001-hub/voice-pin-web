import { remoteWorkspaceService } from './remoteWorkspaceService';

/**
 * 고객 문자로 확인된 전화번호 → 구매자 닉네임 연결을 회차를 넘어 기억한다.
 * 로컬(localStorage)과 클라우드(workspace_settings 'buyer_phone_links')에 함께 저장해
 * 다음 회차, 다른 기기에서도 같은 번호의 문자가 자동으로 그 구매자에 연결되게 한다.
 */

const STORAGE_KEY = 'voicecap_buyer_phone_links';
const REMOTE_NAMESPACE = 'buyer_phone_links';

export interface BuyerPhoneLink {
  nickname: string;
  /** 연결이 처음 확인된 회차 */
  sessionId?: string | null;
  linkedAt: string;
  /** 판매자가 연결을 해제한 번호 — 같은 닉네임으로 다시 자동 저장하지 않는다 */
  blocked?: boolean;
}

export type BuyerPhoneLinkMap = Record<string, BuyerPhoneLink>;

const storageKey = (workspaceId?: string | null) => (workspaceId ? `${STORAGE_KEY}_${workspaceId}` : STORAGE_KEY);

/** 같은 번호면 더 최근 기록을 남긴다 */
export function mergeBuyerPhoneLinks(base: BuyerPhoneLinkMap, incoming: BuyerPhoneLinkMap): BuyerPhoneLinkMap {
  const merged: BuyerPhoneLinkMap = { ...base };
  Object.entries(incoming || {}).forEach(([phone, link]) => {
    if (!phone || !link?.nickname) return;
    const current = merged[phone];
    if (!current || Date.parse(link.linkedAt) > Date.parse(current.linkedAt)) merged[phone] = link;
  });
  return merged;
}

/** 화면에서 쓰는 전화번호 → 닉네임 맵 (해제된 연결 제외) */
export function activeBuyerPhoneLinks(map: BuyerPhoneLinkMap): Map<string, string> {
  const result = new Map<string, string>();
  Object.entries(map).forEach(([phone, link]) => {
    if (!link.blocked && link.nickname) result.set(phone, link.nickname);
  });
  return result;
}

export const buyerPhoneLinkService = {
  load(workspaceId?: string | null): BuyerPhoneLinkMap {
    try {
      const raw = localStorage.getItem(storageKey(workspaceId));
      if (raw) return JSON.parse(raw) as BuyerPhoneLinkMap;
    } catch {}
    return {};
  },

  saveLocal(map: BuyerPhoneLinkMap, workspaceId?: string | null) {
    try {
      localStorage.setItem(storageKey(workspaceId), JSON.stringify(map));
    } catch {}
  },

  /** 클라우드 기록을 받아 로컬과 합친다 */
  async sync(workspaceId?: string | null): Promise<BuyerPhoneLinkMap> {
    const local = this.load(workspaceId);
    if (!workspaceId) return local;
    try {
      const remote = await remoteWorkspaceService.fetchWorkspaceSettings<BuyerPhoneLinkMap>(workspaceId, REMOTE_NAMESPACE);
      const merged = mergeBuyerPhoneLinks(local, remote || {});
      this.saveLocal(merged, workspaceId);
      return merged;
    } catch (err) {
      console.warn('[buyerPhoneLinkService] sync failed:', err);
      return local;
    }
  },

  /** 새 연결을 더해 로컬·클라우드에 저장하고 합친 결과를 돌려준다 */
  async upsert(entries: BuyerPhoneLinkMap, workspaceId?: string | null): Promise<BuyerPhoneLinkMap> {
    const merged = mergeBuyerPhoneLinks(this.load(workspaceId), entries);
    this.saveLocal(merged, workspaceId);
    if (workspaceId) {
      try {
        const remote = await remoteWorkspaceService.fetchWorkspaceSettings<BuyerPhoneLinkMap>(workspaceId, REMOTE_NAMESPACE);
        const all = mergeBuyerPhoneLinks(remote || {}, merged);
        this.saveLocal(all, workspaceId);
        await remoteWorkspaceService.saveWorkspaceSettings(workspaceId, REMOTE_NAMESPACE, all);
        return all;
      } catch (err) {
        console.warn('[buyerPhoneLinkService] remote save failed:', err);
      }
    }
    return merged;
  },
};
