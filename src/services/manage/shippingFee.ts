import type { BuyerShippingOverride, CalculatedShipping, ShippingConfig } from '../../types/shipping.ts';

/**
 * 배송비 계산 (순수 함수).
 * shippingService.calculateShippingFee 와 결과가 같아야 한다 (test/manage-calc.test.mjs 에서 비교).
 * 관리 화면 계산 모듈은 저장소·네트워크를 부르지 않도록 이 함수만 쓴다.
 */
export function computeShippingFee(
  totalProductAmount: number,
  config: ShippingConfig,
  override?: BuyerShippingOverride | null,
): CalculatedShipping {
  let autoFee = 0;
  let autoReason = '';
  if (config.type === 'FREE') {
    autoReason = '조건 없이 무료배송';
  } else if (config.type === 'FIXED') {
    autoFee = config.defaultFee;
    autoReason = `고정 배송비 (${config.defaultFee.toLocaleString()}원)`;
  } else if (totalProductAmount >= config.freeThreshold) {
    autoReason = `${config.freeThreshold.toLocaleString()}원 이상 구매로 무료배송 달성`;
  } else {
    autoFee = config.defaultFee;
    autoReason = `기본 배송비 (${(config.freeThreshold - totalProductAmount).toLocaleString()}원 더 담으면 무료)`;
  }
  if (override && override.mode === 'MANUAL') {
    return {
      fee: override.manualFee,
      isFree: override.manualFee === 0,
      isManual: true,
      originalAutoFee: autoFee,
      reason: override.reason || (override.manualFee === 0 ? '판매자 수동 배송비 면제' : '판매자 수동 지정 금액'),
    };
  }
  return { fee: autoFee, isFree: autoFee === 0, isManual: false, originalAutoFee: autoFee, reason: autoReason };
}
