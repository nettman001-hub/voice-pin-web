import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext';
import { CreditCard, ShieldCheck, Calendar, AlertCircle, RotateCcw, CheckCircle2 } from 'lucide-react';

export const SubscriptionManagePage: React.FC = () => {
  const { currentPlan, subscriptionExpiresAt, isTrialActive, paymentHistory, cancelSubscription } = useAppData();
  const navigate = useNavigate();
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const handleCancel = () => {
    if (window.confirm('정말로 구독을 해지하시겠습니까? 다음 갱신일까지는 정상 이용 가능합니다.')) {
      cancelSubscription();
      setToastMsg('구독 해지가 접수되었습니다. 만료일까지는 모든 기능을 이용하실 수 있습니다.');
      setTimeout(() => setToastMsg(null), 4000);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl">
        <div className="flex items-center space-x-2">
          <h1 className="text-2xl font-black text-white tracking-tight">구독 관리 & 결제 내역</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
            구독 활성 상태
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">현재 이용 중인 구독 플랜을 확인하고 결제 수단 및 이력을 관리합니다.</p>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-amber-500/20 border border-amber-500 text-amber-200 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 현재 구독 상태 카드 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <span className="text-xs text-slate-400 font-semibold">현재 이용 중인 플랜</span>
            <div className="flex items-center space-x-3 mt-1">
              <h2 className="text-2xl font-black text-white">{currentPlan} 플랜</h2>
              {isTrialActive && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 font-bold border border-brand-500/30">
                  7일 무료 체험 중
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Link
              to="/subscription/plans"
              className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-500/20 transition"
            >
              요금제 변경
            </Link>
            <button
              onClick={handleCancel}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 text-xs font-bold border border-slate-700 transition"
            >
              구독 해지
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 text-xs">
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400">구독 상태</span>
            <p className="text-sm font-bold text-emerald-400">정상 이용 중 (활성)</p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400">다음 결제 예정일</span>
            <p className="text-sm font-bold text-white">{subscriptionExpiresAt}</p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400">결제 수단</span>
            <p className="text-sm font-bold text-slate-200">신한카드 (4820)</p>
          </div>
        </div>
      </div>

      {/* 과거 결제 내역 테이블 */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-brand-400" />
          <span>과거 결제 영수증 및 결제 내역</span>
        </h3>

        <div className="space-y-2">
          {paymentHistory.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
            >
              <div>
                <span className="font-bold text-white text-sm">{item.planName}</span>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {item.date} • {item.paymentMethod}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-brand-400 text-sm">
                  {item.amount.toLocaleString()}원
                </div>
                <span className="text-[10px] text-emerald-400 font-semibold">{item.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
