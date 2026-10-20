import { CustomerKeepingRecord, BuyerKeepingSummary } from '../types/keeping';
import { SaleRecord } from '../types/live';
import { areNicknamesSimilar } from './nicknameMatcher';
import { remoteWorkspaceService as productionRemote } from './remoteWorkspaceService';

const KEEPING_STORAGE_KEY = 'voicecap_customer_keeping_records';

const getStorageKey = (workspaceId?: string | null): string => {
  return workspaceId ? `${KEEPING_STORAGE_KEY}_${workspaceId}` : KEEPING_STORAGE_KEY;
};

export function createCustomerKeepingService(remoteWorkspaceService = productionRemote, localStorage: Storage = globalThis.localStorage) {
return {
  /**
   * 로컬 스토리지에서 모든 키핑 기록을 불러옵니다.
   */
  getAllRecords(workspaceId?: string | null): CustomerKeepingRecord[] {
    try {
      const key = getStorageKey(workspaceId);
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.warn('[customerKeepingService] getAllRecords failed:', err);
    }
    return [];
  },

  /**
   * 클라우드(workspace_settings)에서 최신 키핑 기록을 불러와 동기화합니다.
   */
  async fetchRemoteRecords(workspaceId: string): Promise<CustomerKeepingRecord[]> {
    if (!workspaceId) return this.getAllRecords();
    try {
      const remote = await remoteWorkspaceService.fetchWorkspaceSettings<CustomerKeepingRecord[]>(
        workspaceId,
        'customer_keeping_records'
      );
      if (Array.isArray(remote)) {
        localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(remote));
        return remote;
      }
    } catch (err) {
      console.warn('[customerKeepingService] fetchRemoteRecords failed:', err);
    }
    return this.getAllRecords(workspaceId);
  },

  /**
   * 전체 키핑 기록을 저장합니다.
   */
  async saveRecords(records: CustomerKeepingRecord[], workspaceId?: string | null): Promise<void> {
    const key = getStorageKey(workspaceId);
    try {
      localStorage.setItem(key, JSON.stringify(records));
    } catch {}

    if (workspaceId) {
      try {
        await remoteWorkspaceService.saveWorkspaceSettings(workspaceId, 'customer_keeping_records', records);
      } catch (err) {
        console.warn('[customerKeepingService] saveRecords to remote failed:', err);
      }
    }
  },

  /**
   * 특정 구매자의 이전 회차 활성 키핑(보관중) 요약을 조회합니다.
   * @param buyerNickname 구매자 닉네임
   * @param excludeSessionId 현재 진행 중인 회차 ID (현재 회차 키핑 건은 제외하고 '이전 회차' 보관 건만 확인 시 사용)
   */
  getBuyerSummary(
    buyerNickname: string,
    excludeSessionId?: string,
    workspaceId?: string | null
  ): BuyerKeepingSummary {
    const cleanNick = (buyerNickname || '').trim().toLowerCase();
    if (!cleanNick) {
      return {
        buyerNickname,
        hasActiveKeeping: false,
        activeCount: 0,
        totalKeptAmount: 0,
        records: [],
        allSaleIds: []
      };
    }

    const all = this.getAllRecords(workspaceId);
    const activeRecords = all.filter((rec) => {
      if (rec.status !== 'KEPT') return false;
      if (excludeSessionId && rec.sessionId === excludeSessionId) return false;
      // 닉네임 일치 또는 유사도 검사
      return areNicknamesSimilar(cleanNick, rec.buyerNickname);
    });

    const totalKeptAmount = activeRecords.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
    const allSaleIds = activeRecords.flatMap((r) => r.saleIds || []);

    return {
      buyerNickname,
      hasActiveKeeping: activeRecords.length > 0,
      activeCount: activeRecords.length,
      totalKeptAmount,
      records: activeRecords,
      allSaleIds
    };
  },

  /**
   * 판매 건들을 키핑(보관)으로 새로 등록하거나 기존 회차 키핑을 업데이트합니다.
   */
  async setKeeping(
    params: {
      buyerNickname: string;
      phoneNumber?: string;
      sessionId: string;
      sessionCode?: string;
      sales: SaleRecord[];
      memo?: string;
    },
    workspaceId?: string | null
  ): Promise<CustomerKeepingRecord> {
    const all = this.getAllRecords(workspaceId);
    const totalAmount = params.sales.reduce((sum, s) => sum + (s.amount || 0), 0);
    const productNames = params.sales.map((s) => s.productName || '상품').filter(Boolean);
    const saleIds = params.sales.map((s) => s.id);

    // 동일 회차, 동일 구매자의 기존 KEPT 기록이 있으면 갱신, 없으면 신규 생성
    const existingIndex = all.findIndex(
      (r) => r.sessionId === params.sessionId &&
             areNicknamesSimilar(r.buyerNickname, params.buyerNickname) &&
             r.status === 'KEPT'
    );

    const now = new Date().toISOString();
    let record: CustomerKeepingRecord;

    if (existingIndex >= 0) {
      record = {
        ...all[existingIndex],
        saleIds,
        totalAmount,
        productNames,
        sessionCode: params.sessionCode || all[existingIndex].sessionCode,
        memo: params.memo ?? all[existingIndex].memo,
        keptAt: now
      };
      all[existingIndex] = record;
    } else {
      record = {
        id: `keep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        buyerNickname: params.buyerNickname.trim(),
        phoneNumber: params.phoneNumber,
        sessionId: params.sessionId,
        sessionCode: params.sessionCode,
        saleIds,
        totalAmount,
        productNames,
        status: 'KEPT',
        keptAt: now,
        memo: params.memo
      };
      all.unshift(record);
    }

    await this.saveRecords(all, workspaceId);
    return record;
  },

  /**
   * 키핑을 해제(묶음출고 완료) 처리합니다.
   */
  async releaseKeeping(
    keepingId: string,
    releasedSessionId: string,
    workspaceId?: string | null
  ): Promise<void> {
    const all = this.getAllRecords(workspaceId);
    const idx = all.findIndex((r) => r.id === keepingId);
    if (idx >= 0) {
      all[idx] = {
        ...all[idx],
        status: 'RELEASED',
        releasedAt: new Date().toISOString(),
        releasedSessionId
      };
      await this.saveRecords(all, workspaceId);
    }
  },

  /**
   * 구매자의 모든 이전 활성 키핑 건을 이번 회차 묶음으로 일괄 출고 완료 처리합니다.
   */
  async releaseAllBuyerKeeping(
    buyerNickname: string,
    releasedSessionId: string,
    workspaceId?: string | null
  ): Promise<void> {
    const all = this.getAllRecords(workspaceId);
    let changed = false;
    const now = new Date().toISOString();

    for (let i = 0; i < all.length; i++) {
      if (all[i].status === 'KEPT' && areNicknamesSimilar(all[i].buyerNickname, buyerNickname)) {
        all[i] = {
          ...all[i],
          status: 'RELEASED',
          releasedAt: now,
          releasedSessionId
        };
        changed = true;
      }
    }

    if (changed) {
      await this.saveRecords(all, workspaceId);
    }
  },

  /**
   * 키핑 설정을 완전히 취소(삭제)합니다.
   */
  async cancelKeeping(keepingId: string, workspaceId?: string | null): Promise<void> {
    const all = this.getAllRecords(workspaceId);
    const filtered = all.filter((r) => r.id !== keepingId);
    if (filtered.length !== all.length) {
      await this.saveRecords(filtered, workspaceId);
    }
  }
};
}

export const customerKeepingService = createCustomerKeepingService();
