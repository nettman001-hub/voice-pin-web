import { ShippingConfig, BuyerShippingOverride, CalculatedShipping } from '../types/shipping';
import { remoteWorkspaceService } from './remoteWorkspaceService';

const SHIPPING_CONFIG_KEY = 'voicecap_shipping_config';
const SHIPPING_OVERRIDES_KEY = 'voicecap_buyer_shipping_overrides';

export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  type: 'CONDITIONAL_FREE',
  defaultFee: 3000,
  freeThreshold: 50000,
  remoteAreaFee: 3000,
  includeKeepingInThreshold: true,
  updatedAt: new Date().toISOString(),
};

const getStorageKey = (base: string, workspaceId?: string | null): string => {
  return workspaceId ? `${base}_${workspaceId}` : base;
};

export const shippingService = {
  /**
   * 로컬 및 클라우드에서 배송비 정책을 가져옵니다.
   */
  getConfig(workspaceId?: string | null): ShippingConfig {
    try {
      const key = getStorageKey(SHIPPING_CONFIG_KEY, workspaceId);
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SHIPPING_CONFIG, ...parsed };
      }
    } catch (err) {
      console.warn('[shippingService] getConfig failed from localStorage:', err);
    }
    return { ...DEFAULT_SHIPPING_CONFIG };
  },

  /**
   * 클라우드(workspace_settings)에서 최신 설정을 불러와 로컬과 동기화합니다.
   */
  async fetchRemoteConfig(workspaceId: string): Promise<ShippingConfig> {
    if (!workspaceId) return this.getConfig();
    try {
      const remote = await remoteWorkspaceService.fetchWorkspaceSettings<ShippingConfig>(
        workspaceId,
        'shipping_config'
      );
      if (remote) {
        const merged = { ...DEFAULT_SHIPPING_CONFIG, ...remote };
        localStorage.setItem(getStorageKey(SHIPPING_CONFIG_KEY, workspaceId), JSON.stringify(merged));
        return merged;
      }
    } catch (err) {
      console.warn('[shippingService] fetchRemoteConfig failed:', err);
    }
    return this.getConfig(workspaceId);
  },

  /**
   * 배송비 정책을 저장합니다 (로컬 + 클라우드).
   */
  async saveConfig(config: ShippingConfig, workspaceId?: string | null): Promise<void> {
    const updated = { ...config, updatedAt: new Date().toISOString() };
    const key = getStorageKey(SHIPPING_CONFIG_KEY, workspaceId);
    try {
      localStorage.setItem(key, JSON.stringify(updated));
    } catch {}

    if (workspaceId) {
      try {
        await remoteWorkspaceService.saveWorkspaceSettings(workspaceId, 'shipping_config', updated);
      } catch (err) {
        console.warn('[shippingService] saveConfig to remote failed:', err);
      }
    }
  },

  /**
   * 특정 구매자/회차의 수동 택배비 설정을 조회합니다.
   */
  getOverride(
    buyerNickname: string,
    sessionId: string,
    workspaceId?: string | null
  ): BuyerShippingOverride | null {
    if (!buyerNickname) return null;
    try {
      const key = getStorageKey(SHIPPING_OVERRIDES_KEY, workspaceId);
      const raw = localStorage.getItem(key);
      if (raw) {
        const map = JSON.parse(raw) as Record<string, BuyerShippingOverride>;
        const overrideKey = `${sessionId}_${buyerNickname.trim()}`;
        return map[overrideKey] || null;
      }
    } catch {}
    return null;
  },

  /**
   * 특정 구매자/회차의 수동 택배비를 설정(추가, 면제, 수정)합니다.
   */
  async setOverride(
    override: BuyerShippingOverride,
    workspaceId?: string | null
  ): Promise<void> {
    const key = getStorageKey(SHIPPING_OVERRIDES_KEY, workspaceId);
    try {
      const raw = localStorage.getItem(key);
      const map = (raw ? JSON.parse(raw) : {}) as Record<string, BuyerShippingOverride>;
      const overrideKey = `${override.sessionId}_${override.buyerNickname.trim()}`;
      map[overrideKey] = {
        ...override,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(key, JSON.stringify(map));

      if (workspaceId) {
        await remoteWorkspaceService.saveWorkspaceSettings(workspaceId, 'buyer_shipping_overrides', map);
      }
    } catch (err) {
      console.warn('[shippingService] setOverride failed:', err);
    }
  },

  /**
   * 수동 설정을 취소하고 자동 계산으로 복원합니다.
   */
  async clearOverride(
    buyerNickname: string,
    sessionId: string,
    workspaceId?: string | null
  ): Promise<void> {
    const key = getStorageKey(SHIPPING_OVERRIDES_KEY, workspaceId);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const map = JSON.parse(raw) as Record<string, BuyerShippingOverride>;
      const overrideKey = `${sessionId}_${buyerNickname.trim()}`;
      delete map[overrideKey];
      localStorage.setItem(key, JSON.stringify(map));

      if (workspaceId) {
        await remoteWorkspaceService.saveWorkspaceSettings(workspaceId, 'buyer_shipping_overrides', map);
      }
    } catch (err) {
      console.warn('[shippingService] clearOverride failed:', err);
    }
  },

  /**
   * 주문 상품 총액과 정책, 수동 설정을 종합하여 최종 배송비를 계산합니다.
   */
  calculateShippingFee(
    totalProductAmount: number,
    config: ShippingConfig,
    override?: BuyerShippingOverride | null
  ): CalculatedShipping {
    // 1. 자동 기준 배송비 산출
    let autoFee = 0;
    let autoReason = '';

    if (config.type === 'FREE') {
      autoFee = 0;
      autoReason = '조건 없이 무료배송';
    } else if (config.type === 'FIXED') {
      autoFee = config.defaultFee;
      autoReason = `고정 배송비 (${config.defaultFee.toLocaleString()}원)`;
    } else {
      // CONDITIONAL_FREE
      if (totalProductAmount >= config.freeThreshold) {
        autoFee = 0;
        autoReason = `${config.freeThreshold.toLocaleString()}원 이상 구매로 무료배송 달성`;
      } else {
        autoFee = config.defaultFee;
        const remaining = config.freeThreshold - totalProductAmount;
        autoReason = `기본 배송비 (${remaining.toLocaleString()}원 더 담으면 무료)`;
      }
    }

    // 2. 수동 지정이 있는 경우 오버라이드
    if (override && override.mode === 'MANUAL') {
      return {
        fee: override.manualFee,
        isFree: override.manualFee === 0,
        isManual: true,
        originalAutoFee: autoFee,
        reason: override.reason || (override.manualFee === 0 ? '판매자 수동 배송비 면제' : '판매자 수동 지정 금액'),
      };
    }

    return {
      fee: autoFee,
      isFree: autoFee === 0,
      isManual: false,
      originalAutoFee: autoFee,
      reason: autoReason,
    };
  },
};
