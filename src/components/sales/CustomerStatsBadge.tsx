import React, { useMemo } from 'react';
import { useSales } from '../../context/SalesContext';
import { useCommerce } from '../../context/CommerceContext';
import { useLive } from '../../context/LiveContext';
import { useProductSales } from '../../context/ProductSalesContext';
import { SaleRecord } from '../../types/live';
import { CustomerPurchaseClaim, SettlementInvoice, Shipment } from '../../types/commerce';
import { areNicknamesSimilar, normalizeNickname } from '../../services/nicknameMatcher';

interface CustomerStatsBadgeProps {
  nickname?: string;
  variant?: 'compact' | 'pill' | 'detailed';
  className?: string;
  currentSessionId?: string | null;
}

/** 닉네임 비교용 정규화: 특수문자, 공백, 접미사 '님' 제거 및 소문자화 */
export const normalizeBuyerNickname = (name?: string): string => {
  return normalizeNickname(name);
};

export interface CustomerStats {
  purchaseCount: number;
  totalPurchaseCount?: number;
  totalRevenue: number;
  defaultCount: number;
  isFirstTimeBuyer: boolean;
  validSales: SaleRecord[];
}

export interface CalculateCustomerStatsParams {
  nickname?: string;
  sales: SaleRecord[];
  claims?: CustomerPurchaseClaim[];
  invoices?: SettlementInvoice[];
  shipments?: Shipment[];
  isPaid?: (saleIds: string[]) => boolean;
  currentSessionId?: string | null;
  activeSessionId?: string | null;
}

/** 고객 거래 통계 순수 계산 함수 (단위 테스트 및 재사용 가능) */
export const calculateCustomerStats = ({
  nickname,
  sales,
  claims = [],
  invoices = [],
  shipments = [],
  isPaid,
  currentSessionId,
  activeSessionId
}: CalculateCustomerStatsParams): CustomerStats => {
  const normalizedTarget = normalizeBuyerNickname(nickname);
  if (!normalizedTarget || normalizedTarget === '미확인' || normalizedTarget === '미확인(보류)') {
    return { purchaseCount: 0, totalRevenue: 0, defaultCount: 0, isFirstTimeBuyer: false, validSales: [] };
  }

  // 해당 고객의 모든 주문 건 매칭 (정규화 일치 및 규칙 1, 2, 3 비교 적용)
  const customerSales = sales.filter((s) => {
    const saleNorm = normalizeBuyerNickname(s.buyerNickname);
    if (!saleNorm || saleNorm === '미확인' || saleNorm === '미확인(보류)') return false;
    if (saleNorm === normalizedTarget) return true;
    return areNicknamesSimilar(s.buyerNickname, nickname);
  });

  if (customerSales.length === 0) {
    return { purchaseCount: 0, totalPurchaseCount: 0, totalRevenue: 0, defaultCount: 0, isFirstTimeBuyer: false, validSales: [] };
  }

  // 1) 이번 판매회차(현재 방송 세션) 주문 여부 판정 함수:
  // - currentSessionId 또는 activeSessionId가 주어지면 해당 세션 ID 일치 여부로 판정
  // - 둘 다 없는 경우에만 최근 12시간 이내 주문을 현재 세션으로 간주
  const isCurrentSessionSale = (s: SaleRecord) => {
    if (currentSessionId || activeSessionId) {
      return (
        (Boolean(currentSessionId) && s.sessionId === currentSessionId) ||
        (Boolean(activeSessionId) && s.sessionId === activeSessionId)
      );
    }
    return Boolean(s.recognizedAt) && Date.now() - new Date(s.recognizedAt).getTime() < 12 * 60 * 60 * 1000;
  };

  const pastSales = customerSales.filter((s) => !isCurrentSessionSale(s));

  // 1. 구매횟수: 이번 회차 이전(과거 회차)에 구매한 횟수
  const purchaseCount = pastSales.length;
  const totalPurchaseCount = customerSales.length;

  // 2. 누적 매출 및 미이행 건수 계산
  // * 사용자 명시 규칙: 미이행 횟수는 이번 판매회차에서는 완전히 제외하고, 지난 누적회차(과거 세션)에서만 계산함.
  let totalRevenue = 0;
  let defaultCount = 0;

  customerSales.forEach((sale) => {
    const isPastSessionSale = !isCurrentSessionSale(sale);

    // [미이행 횟수] 이번 판매회차는 완전히 제외하고, '지난 누적회차'에서만 계산
    if (isPastSessionSale) {
      let isDefaulted = false;

      // A. 과거 주문 취소 / 반품 / 환불 / 노쇼
      if (
        (sale.status as string) === '취소' ||
        (sale.status as string) === '반품' ||
        (sale.status as string) === '환불'
      ) {
        isDefaulted = true;
      } else if (
        sale.note &&
        (sale.note.includes('반품') ||
          sale.note.includes('취소') ||
          sale.note.includes('환불') ||
          sale.note.includes('노쇼') ||
          sale.note.includes('미입금취소') ||
          sale.note.includes('미입금'))
      ) {
        isDefaulted = true;
      } else if (
        invoices.some((inv) => inv.saleIds.includes(sale.id) && inv.status === 'CANCELLED')
      ) {
        isDefaulted = true;
      } else if (
        shipments.some(
          (ship) =>
            ship.saleIds.includes(sale.id) &&
            (ship.status === 'CANCELLED' || (ship.status as string) === 'RETURNED')
        )
      ) {
        isDefaulted = true;
      } else {
        // B. 과거 주문 정산 인보이스 납부기한 만료 및 미입금
        const overdueInvoice = invoices.find(
          (inv) =>
            inv.saleIds.includes(sale.id) &&
            ((inv.status as string) === 'OVERDUE' ||
              (inv.status !== 'PAID' &&
                inv.dueDate &&
                new Date(inv.dueDate).getTime() < Date.now()))
        );
        if (overdueInvoice && isPaid && !isPaid([sale.id])) {
          isDefaulted = true;
        }
      }

      if (isDefaulted) {
        defaultCount += 1;
      }
    }

    // [누적 매출] 유효 주문만 합산 (취소/반품 및 단순 보류 제외)
    const isCancelled =
      (sale.status as string) === '취소' ||
      (sale.status as string) === '반품' ||
      (sale.status as string) === '환불' ||
      Boolean(
        sale.note &&
          (sale.note.includes('반품') ||
            sale.note.includes('취소') ||
            sale.note.includes('환불') ||
            sale.note.includes('노쇼') ||
            sale.note.includes('미입금취소'))
      );

    if (!isCancelled && sale.status !== '보류') {
      totalRevenue += sale.amount || 0;
    }
  });

  // 첫구매자 판정: 지난 회차에 구매한 것이 없고(pastSales.length === 0), 이번 회차에 주문이 존재할 때
  const isFirstTimeBuyer = pastSales.length === 0 && customerSales.length > 0;

  return {
    purchaseCount,
    totalPurchaseCount,
    totalRevenue,
    defaultCount,
    isFirstTimeBuyer,
    validSales: customerSales
  };
};

export const useCustomerStats = (
  nickname?: string,
  overrideCurrentSessionId?: string | null
): CustomerStats => {
  const { sales } = useSales();
  const { claims, invoices, shipments, isPaid } = useCommerce();
  const { currentSessionId } = useLive();
  const { activeSession } = useProductSales();

  const effectiveSessionId =
    overrideCurrentSessionId !== undefined ? overrideCurrentSessionId : currentSessionId;

  return useMemo(() => {
    return calculateCustomerStats({
      nickname,
      sales,
      claims,
      invoices,
      shipments,
      isPaid,
      currentSessionId: effectiveSessionId,
      activeSessionId: activeSession?.id
    });
  }, [nickname, sales, claims, invoices, shipments, isPaid, effectiveSessionId, activeSession?.id]);
};

export const CustomerStatsBadge: React.FC<CustomerStatsBadgeProps> = ({
  nickname,
  variant = 'pill',
  className = '',
  currentSessionId
}) => {
  const stats = useCustomerStats(nickname, currentSessionId);

  // 구매 이력이 전혀 없으면 표시하지 않음 (이전 구매 0회라도 이번 회차 첫구매 이력이 있으면 표시)
  if (stats.validSales.length === 0) {
    return null;
  }

  // 1. 실시간 댓글 리스트용 컴팩트 모드 (한 줄 미니 배지)
  if (variant === 'compact') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-100/90 border border-slate-200/80 text-[10px] font-semibold text-slate-600 whitespace-nowrap flex-shrink-0 ${className}`}
        title={`${nickname} 고객 구매 통계`}
      >
        {stats.isFirstTimeBuyer && (
          <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 font-extrabold text-[9px] border border-emerald-200">
            첫구매
          </span>
        )}
        <span>
          구매 <strong className="text-slate-800 font-bold">{stats.purchaseCount}회</strong>
        </span>
        <span className="text-slate-300">·</span>
        <span>
          누적 <strong className="text-slate-800 font-bold">{stats.totalRevenue.toLocaleString()}원</strong>
        </span>
        <span className="text-slate-300">·</span>
        <span>
          미이행{' '}
          <strong
            className={
              stats.defaultCount > 0 ? 'text-rose-600 font-black' : 'text-slate-500 font-medium'
            }
          >
            {stats.defaultCount}회
          </strong>
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
        {stats.isFirstTimeBuyer && (
          <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[9px]">
            첫구매
          </span>
        )}
        <span>
          구매 <strong className="font-bold text-slate-900">{stats.purchaseCount}회</strong>
        </span>
        <span className="text-slate-300">|</span>
        <span>
          누적 <strong className="font-bold text-slate-900">{stats.totalRevenue.toLocaleString()}원</strong>
        </span>
        <span className="text-slate-300">|</span>
        <span
          className={
            stats.defaultCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-500 font-medium'
          }
        >
          미이행{' '}
          <strong
            className={
              stats.defaultCount > 0 ? 'font-black text-rose-600' : 'font-bold text-slate-600'
            }
          >
            {stats.defaultCount}회
          </strong>
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
        {stats.isFirstTimeBuyer && (
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[10px] border border-emerald-200">
            첫구매 고객
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
        <div className="flex items-center space-x-1">
          <span className="text-slate-500 text-[11px]">이전 구매횟수:</span>
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
          <span
            className={`text-xs sm:text-sm px-1.5 py-0.5 rounded border ${
              stats.defaultCount > 0
                ? 'font-black text-rose-600 bg-rose-50 border-rose-200/80'
                : 'font-bold text-slate-600 bg-slate-100 border-slate-200'
            }`}
          >
            {stats.defaultCount}회
          </span>
        </div>
      </div>
    </div>
  );
};
