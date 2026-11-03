import type { ShippingConfig } from '../types/shipping.ts';

/** 배송비 정책 처음 값. 웹과 sales-api(관리 홈 요약)가 같이 쓴다. */
export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  type: 'CONDITIONAL_FREE',
  defaultFee: 3000,
  freeThreshold: 50000,
  remoteAreaFee: 3000,
  includeKeepingInThreshold: true,
  updatedAt: new Date().toISOString(),
};
