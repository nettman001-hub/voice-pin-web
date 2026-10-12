export type ShippingConditionType =
  | 'FREE'              // 조건 없이 무료 (0원)
  | 'CONDITIONAL_FREE'  // xxx원 이상 무료 (기본 배송비 적용)
  | 'FIXED';            // 무조건 xxx원 (고정 배송비)

export interface ShippingConfig {
  type: ShippingConditionType;
  defaultFee: number;          // 기본 택배비 (예: 3,000원)
  freeThreshold: number;       // 무료배송 기준 금액 (예: 50,000원)
  remoteAreaFee: number;       // 도서산간 추가 배송비 (선택, 기본 3,000원)
  includeKeepingInThreshold: boolean; // 키핑 합산 금액으로 무료 기준 계산 여부 (기본: true)
  updatedAt: string;
}

export interface BuyerShippingOverride {
  buyerNickname: string;
  sessionId: string;
  mode: 'AUTO' | 'MANUAL';     // AUTO: 자동 규칙 적용, MANUAL: 판매자 수동 지정
  manualFee: number;           // 수동 지정 금액 (0원이면 면제)
  reason?: string;             // 예: '단골 면제', '도서산간 추가'
  updatedAt: string;
}

export interface CalculatedShipping {
  fee: number;
  isFree: boolean;
  isManual: boolean;
  originalAutoFee: number;
  reason: string;
}
