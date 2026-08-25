import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { PaymentHistoryItem } from '../../types/subscription';
import { CreditCard, Shield, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';

export const SubscriptionManagePage: React.FC = () => {
  const { currentPlan, subscriptionExpiresAt, paymentHistory, cancelSubscription } = useAppData();
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const handleCancel = () => {
    if (window.confirm('정말 구독을 해지하시겠습니까? 남은 기간 동안은 계속 이용하실 수 있습니다.')) {
      cancelSubscription();
      setToastMsg('구독이 성공적으로 해지되었습니다. 현재 결제 주기 만료 후 무료 플랜으로 전환됩니다.');
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-6">
      <div className="bg-white border border-slate-200 p-4 sm:p-6 rounded-3xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">구독 & 결제 관리</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] sm:text-xs font-bold border border-brand-200">
              {currentPlan} 이용 중
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
            현재 이용 중인 요금제 상태를 확인하고, 플랜 변경 및 결제 영수증 내역을 관리합니다.
          </p>
        </div>

        <Link
          to="/subscription/plans"
          className="w-full md:w-auto px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/20 flex items-center justify-center space-x-1.5 transition active:scale-95 text-center"
        >
          <span>플랜 업그레이드 / 변경</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 현재 구독 상태 카드 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3 sm:space-y-4">
        <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
          <Shield className="w-4 h-4 text-brand-600" />
          <span>현재 활성화된 멤버십</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-4 pt-1">
          <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] sm:text-[11px] text-slate-500">구독 요금제</span>
            <div className="text-base sm:text-lg font-black text-brand-600 mt-1">{currentPlan} 플랜</div>
          </div>
          <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] sm:text-[11px] text-slate-500">다음 결제 예정일 / 만료일</span>
            <div className="text-base sm:text-lg font-bold text-slate-900 mt-1">{subscriptionExpiresAt}</div>
          </div>
          <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] sm:text-[11px] text-slate-500">결제 수단</span>
            <div className="text-xs sm:text-sm font-bold text-slate-900 mt-1">현대카드 (•••• 4242)</div>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={handleCancel}
            className="text-xs text-rose-600 hover:text-rose-700 hover:underline font-semibold"
          >
            구독 해지하기
          </button>
        </div>
      </div>

      {/* 결제 이력 내역 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-3 sm:space-y-4">
        <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-2">
          <CreditCard className="w-4 h-4 text-brand-600" />
          <span>결제 이력 ({paymentHistory.length}건)</span>
        </h3>

        <div className="space-y-2.5">
          {paymentHistory.map((hist: PaymentHistoryItem) => (
            <div
              key={hist.id}
              className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
            >
              <div>
                <div className="font-bold text-slate-900 text-xs sm:text-sm">{hist.planName} 플랜 정기 결제</div>
                <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">{hist.date} • {hist.paymentMethod}</div>
              </div>
              <div className="text-right">
                <span className="font-black text-slate-900 text-xs sm:text-sm">{hist.amount.toLocaleString()}원</span>
                <span className="block text-[10px] text-emerald-600 font-bold">{hist.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
