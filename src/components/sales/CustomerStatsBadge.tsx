import React, { useMemo } from 'react';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { useLive } from '../../context/LiveContext';
import { SaleRecord } from '../../types/live';

interface CustomerStatsBadgeProps {
  nickname?: string;
  variant?: 'compact' | 'pill' | 'detailed';
  className?: string;
}

/** 닉네임 비교용 정규화: 특수문자, 공백, 접미사 '님' 제거 및 소문자화 */
export const normalizeBuyerNickname = (name?: string): string => {
  if (!name) return '';
  return name
    .trim()
    .replace(/^@/, '')
    .replace(/\s+/g, '')
    .replace(/님$/u, '')
    .toLowerCase();
};

export interface CustomerStats {
  purchaseCount: number;
  totalRevenue: number;
  defaultCount: number;
  validSales: SaleRecord[];
}

export const useCustomerStats = (nickname?: string): CustomerStats => {
  const { sales } = useSales();
  const { claims, invoices, shipments, isPaid } = useCommerce();
  const { currentSessionId } = useLive();

  return useMemo(() => {
    const normalizedTarget = normalizeBuyerNickname(nickname);
    if (!normalizedTarget || normalizedTarget === '미확인' || normalizedTarget === '미확인(보류)') {
      return { purchaseCount: 0, totalRevenue: 0, defaultCount: 0, validSales: [] };
    }

    // 해당 고객의 모든 주문 건 매칭
    const customerSales = sales.filter(
      (s) => normalizeBuyerNickname(s.buyerNickname) === normalizedTarget
    );

    if (customerSales.length === 0) {
      return { purchaseCount: 0, totalRevenue: 0, defaultCount: 0, validSales: [] };
    }

    // 1. 구매횟수: 전체 주문 건수
    const purchaseCount = customerSales.length;

    // 2. 누적 매출: 보류/취소가 아닌 유효 판매의 합계
    const totalRevenue = customerSales
      .filter((s) => s.status !== '보류')
      .reduce((sum, s) => sum + (s.amount || 0), 0);

    // 3. 미이행 횟수: 주문 후 문자미수신, 미입금, 반품 등 약속을 지키지 않은 건수
    let defaultCount = 0;

    customerSales.forEach((sale) => {
      let isDefaulted = false;

      // A. 반품 / 취소 / 보류
      if (sale.status === '보류') {
        isDefaulted = true;
      } else if (
        sale.note &&
        (sale.note.includes('반품') ||
          sale.note.includes('취소') ||
          sale.note.includes('환불') ||
          sale.note.includes('미입금'))
      ) {
        isDefaulted = true;
      } else if (
        invoices.some((inv) => inv.saleIds.includes(sale.id) && inv.status === 'CANCELLED')
      ) {
        isDefaulted = true;
      } else if (
        shipments.some((ship) => ship.saleIds.includes(sale.id) && ship.status === 'CANCELLED')
      ) {
        isDefaulted = true;
      }

      // B. 과거 회차 주문의 문자미수신 또는 미입금 검사 (현재 라이브 중인 주문은 아직 작성/입금 중일 수 있으므로 제외)
      if (!isDefaulted && sale.sessionId !== currentSessionId) {
        // 문자 미수신 검사
        const matchedClaim = claims.find((c) => c.saleIds.includes(sale.id));
        if (!matchedClaim || matchedClaim.matchStatus === 'NOT_RECEIVED') {
          isDefaulted = true;
        } else {
          // 미입금 검사
          const paid = isPaid([sale.id]);
          if (!paid) {
            isDefaulted = true;
          }
        }
      }

      if (isDefaulted) {
        defaultCount += 1;
      }
    });

    return {
      purchaseCount,
      totalRevenue,
      defaultCount,
      validSales: customerSales
    };
  }, [nickname, sales, claims, invoices, shipments, isPaid, currentSessionId]);
};

export const CustomerStatsBadge: React.FC<CustomerStatsBadgeProps> = ({
  nickname,
  variant = 'pill',
  className = ''
}) => {
  const stats = useCustomerStats(nickname);

  // 구매 이력이 없으면 표시하지 않음
  if (stats.purchaseCount === 0) {
    return null;
  }

  // 1. 실시간 댓글 리스트용 컴팩트 모드 (한 줄 미니 배지)
  if (variant === 'compact') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-100/90 border border-slate-200/80 text-[10px] font-semibold text-slate-600 whitespace-nowrap flex-shrink-0 ${className}`}
        title={`${nickname} 고객 구매 통계`}
      >
        <span>
          구매 <strong className="text-slate-800 font-bold">{stats.purchaseCount}회</strong>
        </span>
        <span className="text-slate-300">·</span>
        <span>
          누적 <strong className="text-slate-800 font-bold">{stats.totalRevenue.toLocaleString()}원</strong>
        </span>
        <span className="text-slate-300">·</span>
        <span>
          미이행 <strong className="text-rose-600 font-black">{stats.defaultCount}회</strong>
        </span>
      </span>
    );
  }

  // 2. 자동 적재 판매 내역 카드용 알약 배지
  if (variant === 'pill') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-medium text-slate-700 whitespace-nowrap ${className}`}
      >
        <span>
          구매 <strong className="font-bold text-slate-900">{stats.purchaseCount}회</strong>
        </span>
        <span className="text-slate-300">|</span>
        <span>
          누적 <strong className="font-bold text-slate-900">{stats.totalRevenue.toLocaleString()}원</strong>
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-rose-600 font-bold">
          미이행 <strong className="font-black text-rose-600">{stats.defaultCount}회</strong>
        </span>
      </span>
    );
  }

  // 3. 판매 상세 정보 화면용 상세 요약 카드
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 p-3 sm:p-3.5 rounded-2xl bg-gradient-to-r from-slate-50 to-indigo-50/40 border border-slate-200/90 text-xs shadow-sm ${className}`}
    >
      <div className="flex items-center space-x-2">
        <span className="px-2 py-0.5 rounded-md bg-brand-600 text-white font-bold text-[10px] tracking-wide">
          고객 이력
        </span>
        <span className="font-bold text-slate-800">
          {nickname} 고객님의 누적 거래 정보
        </span>
      </div>

      <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
        <div className="flex items-center space-x-1">
          <span className="text-slate-500 text-[11px]">총 구매횟수:</span>
          <span className="font-extrabold text-slate-900 text-xs sm:text-sm">
            {stats.purchaseCount}회
          </span>
        </div>
        <div className="w-[1px] h-3 bg-slate-200" />
        <div className="flex items-center space-x-1">
          <span className="text-slate-500 text-[11px]">누적 매출:</span>
          <span className="font-extrabold text-brand-600 text-xs sm:text-sm">
            {stats.totalRevenue.toLocaleString()}원
          </span>
        </div>
        <div className="w-[1px] h-3 bg-slate-200" />
        <div className="flex items-center space-x-1">
          <span className="text-slate-500 text-[11px]">미이행 횟수:</span>
          <span className="font-black text-rose-600 text-xs sm:text-sm bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200/80">
            {stats.defaultCount}회
          </span>
        </div>
      </div>
    </div>
  );
};
