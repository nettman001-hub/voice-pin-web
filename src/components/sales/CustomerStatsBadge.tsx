import React from 'react';
import { useCustomerStatsIndex } from '../../context/CustomerStatsContext';
import { emptyCustomerStats, customerStatsLabel } from '../../services/customerStatsIndex';
export { calculateCustomerStats } from '../../services/customerStatsIndex';
export type { CustomerStats } from '../../services/customerStatsIndex';
interface CustomerStatsBadgeProps {
  nickname?: string;
  buyerId?: string;
  platformUserId?: string;
  uniqueId?: string;
  variant?: 'compact' | 'pill' | 'detailed';
  className?: string;
  currentSessionId?: string | null;
}
export const useCustomerStats = (nickname?: string, _session?: string | null, buyerId?: string) =>
  useCustomerStatsIndex()?.lookup({ nickname, buyerId }) || emptyCustomerStats();

export const CustomerStatsBadge: React.FC<CustomerStatsBadgeProps> = ({
  nickname,
  buyerId,
  platformUserId,
  uniqueId,
  variant = 'pill',
  className = '',
  currentSessionId
}) => {
  const index = useCustomerStatsIndex();
  const stats = index?.lookup({ nickname, buyerId, platformUserId, uniqueId }) || emptyCustomerStats();
  const label = customerStatsLabel(stats);
  if (!label && !stats.validSales.length) return null;
  if(stats.ambiguous)return <span className={`text-xs font-bold text-amber-700 ${className}`}>동명 · 계정 확인 필요</span>;
  if (variant === 'compact') return (
    <span className={`text-[10px] font-semibold ${stats.defaultCount ? 'text-rose-600' : 'text-slate-500'} ${className}`} title={`${nickname} 고객 구매 통계`}>{label}</span>
  );

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
          구매 <strong className="font-bold text-slate-900">{stats.purchaseCount}건/{stats.purchaseSessionCount}회</strong>
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
            {stats.purchaseCount}건/{stats.purchaseSessionCount}회
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
