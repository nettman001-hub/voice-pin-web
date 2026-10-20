import { useWorkspaceRuntime, useRuntimeAuth as useAuth } from '../../context/WorkspaceRuntimeContext';
import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  Package,
  CheckCircle2,
  Edit3,
  RotateCcw,
  Sparkles,
  Plus,
  Minus,
  Check,
  X,
  Clock,
  Layers,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

import { SaleRecord } from '../../types/live';
import { ShippingConfig, BuyerShippingOverride, CalculatedShipping } from '../../types/shipping';

import { BuyerKeepingSummary, CustomerKeepingRecord } from '../../types/keeping';
import { calculateBillableAmount, isBillableSale } from '../../services/billableSales';

interface BuyerShippingCardProps {
  buyerNickname: string;
  sessionId: string;
  sessionCode?: string;
  currentSales: SaleRecord[];
  className?: string;
  onShippingChanged?: (calculated: CalculatedShipping, combinedTotal: number) => void;
  onKeepingChanged?: () => void;
}

export const BuyerShippingCard: React.FC<BuyerShippingCardProps> = ({
  buyerNickname,
  sessionId,
  sessionCode,
  currentSales,
  className = '',
  onShippingChanged,
  onKeepingChanged
}) => {
  const runtime = useWorkspaceRuntime();
  const { shippingService, customerKeepingService } = runtime;
  const { workspaceId } = useAuth();

  // 1. 배송비 설정 & 수동 오버라이드 상태
  const [shippingConfig, setShippingConfig] = useState<ShippingConfig>(() =>
    shippingService.getConfig(workspaceId)
  );
  const [override, setOverride] = useState<BuyerShippingOverride | null>(() =>
    shippingService.getOverride(buyerNickname, sessionId, workspaceId)
  );

  // 2. 키핑(보관) 요약 및 합산 여부
  const [keepingSummary, setKeepingSummary] = useState<BuyerKeepingSummary>(() =>
    customerKeepingService.getBuyerSummary(buyerNickname, sessionId, workspaceId)
  );
  // 이전 키핑 상품을 이번 회차 주문과 함께 묶음 배송할 것인지 여부
  const [combineKeeping, setCombineKeeping] = useState<boolean>(true);
  const [isKeepingExpanded, setIsKeepingExpanded] = useState<boolean>(false);

  // 3. 수동 배송비 인라인 수정 모드 상태
  const [isEditingFee, setIsEditingFee] = useState(false);
  const [customFeeInput, setCustomFeeInput] = useState('');

  // 설정 및 키핑 데이터 갱신
  const reloadData = () => {
    setShippingConfig(shippingService.getConfig(workspaceId));
    setOverride(shippingService.getOverride(buyerNickname, sessionId, workspaceId));
    setKeepingSummary(customerKeepingService.getBuyerSummary(buyerNickname, sessionId, workspaceId));
  };

  useEffect(() => {
    reloadData();
  }, [buyerNickname, sessionId, workspaceId]);

  // 현재 회차 상품 순수 합계
  const currentProductAmount = useMemo(() => calculateBillableAmount(currentSales), [currentSales]);

  // 합산 적용된 상품 총액 (키핑 묶음 시 키핑 금액 포함)
  const effectiveProductAmount = useMemo(() => {
    if (combineKeeping && keepingSummary.hasActiveKeeping && shippingConfig.includeKeepingInThreshold) {
      return currentProductAmount + keepingSummary.totalKeptAmount;
    }
    return currentProductAmount;
  }, [currentProductAmount, combineKeeping, keepingSummary, shippingConfig.includeKeepingInThreshold]);

  // 배송비 계산
  const calculatedShipping = useMemo(() => {
    return shippingService.calculateShippingFee(effectiveProductAmount, shippingConfig, override);
  }, [effectiveProductAmount, shippingConfig, override]);

  // 최종 결제 총액 (상품 + 키핑합산 + 최종 택배비)
  const finalTotalAmount = useMemo(() => {
    const productBase = combineKeeping && keepingSummary.hasActiveKeeping
      ? currentProductAmount + keepingSummary.totalKeptAmount
      : currentProductAmount;
    return productBase + calculatedShipping.fee;
  }, [currentProductAmount, combineKeeping, keepingSummary, calculatedShipping.fee]);

  // 변경 알림 콜백
  useEffect(() => {
    onShippingChanged?.(calculatedShipping, finalTotalAmount);
  }, [calculatedShipping, finalTotalAmount, onShippingChanged]);

  // 현재 회차 건이 이미 키핑으로 지정되어 있는지 확인
  const isCurrentSessionKept = useMemo(() => {
    const allKept = customerKeepingService.getAllRecords(workspaceId);
    return allKept.some(
      (r) => r.sessionId === sessionId && r.buyerNickname.trim().toLowerCase() === buyerNickname.trim().toLowerCase() && r.status === 'KEPT'
    );
  }, [sessionId, buyerNickname, workspaceId]);

  // 수동 금액 저장 처리
  const handleSaveCustomFee = async (fee: number, reason: string) => {
    await shippingService.setOverride(
      {
        buyerNickname,
        sessionId,
        mode: 'MANUAL',
        manualFee: Math.max(0, fee),
        reason,
        updatedAt: new Date().toISOString()
      },
      workspaceId
    );
    setOverride(shippingService.getOverride(buyerNickname, sessionId, workspaceId));
    setIsEditingFee(false);
  };

  // 자동 복원 처리
  const handleResetToAuto = async () => {
    await shippingService.clearOverride(buyerNickname, sessionId, workspaceId);
    setOverride(null);
    setIsEditingFee(false);
  };

  // 이번 회차 판매 건을 키핑(보관)으로 토글 처리
  const handleToggleCurrentKeeping = async () => {
    if (isCurrentSessionKept) {
      // 키핑 취소 (일반 주문으로 복원)
      const all = customerKeepingService.getAllRecords(workspaceId);
      const target = all.find(
        (r) => r.sessionId === sessionId && r.buyerNickname.trim().toLowerCase() === buyerNickname.trim().toLowerCase() && r.status === 'KEPT'
      );
      if (target) {
        await customerKeepingService.cancelKeeping(target.id, workspaceId);
      }
    } else {
      // 키핑 지정
      await customerKeepingService.setKeeping(
        {
          buyerNickname,
          sessionId,
          sessionCode,
          sales: currentSales.filter(isBillableSale)
        },
        workspaceId
      );
    }
    reloadData();
    onKeepingChanged?.();
  };

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 space-y-3 shadow-xs ${className}`}>
      {/* 상단 타이틀 & 키핑 토글 */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-brand-50 text-brand-600 border border-brand-200">
            <Truck className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-black text-slate-900">배송비 & 키핑(보관) 정산</h4>
            <span className="text-[10px] text-slate-500">배송 조건 자동 판정 및 수동 가감</span>
          </div>
        </div>

        {/* 현재 회차 주문 키핑 지정 버튼 */}
        <button
          type="button"
          onClick={handleToggleCurrentKeeping}
          className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition flex items-center gap-1 ${
            isCurrentSessionKept
              ? 'bg-purple-600 text-white border-purple-600 shadow-2xs hover:bg-purple-700'
              : 'bg-slate-50 text-purple-700 border-purple-200 hover:bg-purple-50'
          }`}
          title="고객이 보관을 요청한 경우 이번 회차 주문을 키핑 상태로 보관합니다"
        >
          <Package className="w-3.5 h-3.5" />
          <span>{isCurrentSessionKept ? '✓ 보관(키핑) 지정됨' : '이번 주문 키핑(보관)'}</span>
        </button>
      </div>

      {/* 이전 회차 키핑(보관) 내역 카드 (키핑 기록이 있을 때만 표시) */}
      {keepingSummary.hasActiveKeeping && (
        <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="p-1 rounded-md bg-purple-100 text-purple-700">
                <Sparkles className="w-3.5 h-3.5" />
              </span>
              <span className="text-xs font-black text-purple-900">
                이전 회차 보관(키핑) 상품 {keepingSummary.activeCount}건
              </span>
              <span className="text-xs font-black text-purple-700">
                (+{keepingSummary.totalKeptAmount.toLocaleString()}원)
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsKeepingExpanded(!isKeepingExpanded)}
              className="text-[10px] font-bold text-purple-700 hover:text-purple-900 flex items-center gap-0.5"
            >
              <span>{isKeepingExpanded ? '접기' : '내역 보기'}</span>
              {isKeepingExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* 펼쳐진 키핑 상세 상품 목록 */}
          {isKeepingExpanded && (
            <div className="pt-2 border-t border-purple-200/60 space-y-1.5">
              {keepingSummary.records.map((rec) => (
                <div key={rec.id} className="flex items-center justify-between text-[11px] bg-white/80 p-2 rounded-lg border border-purple-100">
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-bold text-slate-500 text-[10px]">[{rec.sessionCode || rec.sessionId}]</span>
                    <span className="font-bold text-slate-800 truncate">{rec.productNames?.join(', ') || '보관 상품'}</span>
                  </div>
                  <span className="font-black text-purple-700 ml-2 whitespace-nowrap">
                    {(rec.totalAmount || 0).toLocaleString()}원
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 이번 회차와 함께 묶음 배송 토글 */}
          <div className="flex items-center justify-between pt-1 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer font-bold text-purple-950">
              <input
                type="checkbox"
                checked={combineKeeping}
                onChange={(e) => setCombineKeeping(e.target.checked)}
                className="rounded text-purple-600 focus:ring-purple-500"
              />
              <span>이번 회차에 함께 묶음 배송 (금액 합산 및 무료배송 반영)</span>
            </label>
            <span className="text-[10px] text-purple-600">
              {combineKeeping ? '✓ 묶음 적용됨' : '단독 배송'}
            </span>
          </div>
        </div>
      )}

      {/* 금액 및 택배비 요약 영역 */}
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
        {/* 상품 금액 행 */}
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>현재 회차 주문 금액</span>
          <span className="font-bold text-slate-800">{currentProductAmount.toLocaleString()}원</span>
        </div>

        {/* 키핑 합산 행 (묶음 시) */}
        {combineKeeping && keepingSummary.hasActiveKeeping && (
          <div className="flex items-center justify-between text-xs text-purple-700">
            <span className="flex items-center gap-1">
              <Package className="w-3.5 h-3.5 text-purple-500" />
              이전 키핑 보관 상품 합산
            </span>
            <span className="font-bold">+{keepingSummary.totalKeptAmount.toLocaleString()}원</span>
          </div>
        )}

        {/* 택배비 행 및 수동 조작 */}
        <div className="pt-2 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-700">택배비</span>
            {calculatedShipping.isManual ? (
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                수동 지정
              </span>
            ) : calculatedShipping.isFree ? (
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                무료 조건 달성
              </span>
            ) : (
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">
                기본 정책
              </span>
            )}
            <span className="text-[11px] text-slate-400">({calculatedShipping.reason})</span>
          </div>

          {/* 택배비 금액 & 인라인 수정 */}
          <div className="flex items-center gap-1.5 justify-end">
            {isEditingFee ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  autoFocus
                  value={customFeeInput}
                  onChange={(e) => setCustomFeeInput(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="배송비"
                  className="w-20 px-2 py-0.5 text-xs font-black border border-brand-500 rounded text-right focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveCustomFee(parseInt(customFeeInput || '0', 10), '판매자 수동 직접 입력');
                    } else if (e.key === 'Escape') {
                      setIsEditingFee(false);
                    }
                  }}
                />
                <span className="text-xs text-slate-500">원</span>
                <button
                  type="button"
                  onClick={() => handleSaveCustomFee(parseInt(customFeeInput || '0', 10), '판매자 수동 직접 입력')}
                  className="p-1 rounded bg-brand-600 text-white hover:bg-brand-700"
                  title="저장"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingFee(false)}
                  className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300"
                  title="취소"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-black ${calculatedShipping.fee === 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                  {calculatedShipping.fee === 0 ? '0원 (무료)' : `${calculatedShipping.fee.toLocaleString()}원`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCustomFeeInput(String(calculatedShipping.fee));
                    setIsEditingFee(true);
                  }}
                  className="text-[10px] text-brand-600 hover:text-brand-800 underline font-bold"
                  title="배송비 직접 수정"
                >
                  수정
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 판매자 빠른 수동 조작 버튼 바 (면제 0원 / +도서산간 3,000원 / 자동 복원) */}
        <div className="flex items-center gap-1.5 pt-1.5 overflow-x-auto no-scrollbar">
          <span className="text-[10px] text-slate-400 whitespace-nowrap">빠른 조작:</span>
          
          {/* 배송비 0원 면제 버튼 */}
          <button
            type="button"
            onClick={() => handleSaveCustomFee(0, '단골 서비스 0원 면제')}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition whitespace-nowrap ${
              override?.mode === 'MANUAL' && override.manualFee === 0
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
            }`}
          >
            0원 면제
          </button>

          {/* 도서산간 +3,000원 추가 버튼 */}
          <button
            type="button"
            onClick={() => handleSaveCustomFee(calculatedShipping.originalAutoFee + (shippingConfig.remoteAreaFee || 3000), '도서산간비 추가')}
            className="text-[10px] font-bold px-2 py-0.5 rounded-lg border bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50 transition whitespace-nowrap flex items-center gap-0.5"
          >
            <Plus className="w-2.5 h-2.5" /> 도서산간(+{(shippingConfig.remoteAreaFee || 3000).toLocaleString()}원)
          </button>

          {/* 수동 설정이 되어있을 때: 자동 복원 버튼 */}
          {override && (
            <button
              type="button"
              onClick={handleResetToAuto}
              className="text-[10px] font-bold px-2 py-0.5 rounded-lg border bg-white text-slate-500 border-slate-200 hover:bg-slate-100 transition whitespace-nowrap flex items-center gap-0.5 ml-auto"
            >
              <RotateCcw className="w-2.5 h-2.5" /> 자동 규칙 복원
            </button>
          )}
        </div>
      </div>

      {/* 최종 청구 총액 강조 */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs font-black text-slate-900">최종 청구 합계</span>
        <div className="text-right">
          <span className="text-base sm:text-lg font-black text-brand-700">
            {finalTotalAmount.toLocaleString()}원
          </span>
          <span className="block text-[10px] text-slate-400">
            상품 {((combineKeeping && keepingSummary.hasActiveKeeping ? currentProductAmount + keepingSummary.totalKeptAmount : currentProductAmount)).toLocaleString()}원 + 택배비 {calculatedShipping.fee.toLocaleString()}원
          </span>
        </div>
      </div>
    </div>
  );
};
