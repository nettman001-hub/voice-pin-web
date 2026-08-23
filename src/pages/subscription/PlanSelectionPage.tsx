import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SUBSCRIPTION_PLANS, useAppData } from '../../context/AppDataContext';
import { Sparkles, Check, ArrowRight } from 'lucide-react';

export const PlanSelectionPage: React.FC = () => {
  const { currentPlan, setSelectedPlanForCheckout } = useAppData();
  const navigate = useNavigate();

  const handleSelect = (planId: '베이직' | '프로' | '프리미엄') => {
    setSelectedPlanForCheckout(planId);
    navigate('/subscription/payment');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl">
        <div className="flex items-center space-x-2">
          <h1 className="text-2xl font-black text-white tracking-tight">구독 요금제 선택</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 text-xs font-bold">
            언제든 변경 가능
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          방송 규모와 판매 빈도에 맞는 최적의 플랜을 선택하고 정기 결제를 시작하세요.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id;

          return (
            <div
              key={plan.id}
              className={`rounded-3xl p-8 flex flex-col justify-between border transition ${
                plan.isPopular
                  ? 'bg-gradient-to-b from-slate-900 to-brand-950/30 border-brand-500 shadow-xl'
                  : 'bg-slate-900 border-slate-800'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                  {isCurrent && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                      현재 이용 중
                    </span>
                  )}
                </div>

                <div className="mt-4 flex items-baseline">
                  <span className="text-4xl font-black text-white">{plan.priceMonth.toLocaleString()}</span>
                  <span className="text-sm font-semibold text-slate-400 ml-1">원 / 월</span>
                </div>

                <div className="mt-6 space-y-2 text-xs text-slate-300 border-t border-slate-800 pt-4">
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">음성 인식 시간</span>
                    <span className="font-bold text-white">{plan.voiceHours}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">판매 내역 저장</span>
                    <span className="font-bold text-white">{plan.salesCapacity}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">댓글창 캡처</span>
                    <span className="font-bold text-white">{plan.captureCapacity}</span>
                  </div>
                </div>

                <div className="mt-6 space-y-2">
                  <p className="text-xs font-bold text-slate-200">주요 혜택:</p>
                  {plan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-start text-xs text-slate-300 space-x-2">
                      <Check className="w-4 h-4 text-brand-400 flex-shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 pt-4 border-t border-slate-800">
                <button
                  onClick={() => handleSelect(plan.id)}
                  disabled={isCurrent}
                  className={`w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition ${
                    isCurrent
                      ? 'bg-slate-800 text-slate-400 cursor-default'
                      : plan.isPopular
                      ? 'bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 text-white shadow-lg shadow-brand-500/25'
                      : 'bg-slate-800 hover:bg-slate-700 text-white'
                  }`}
                >
                  <span>{isCurrent ? '현재 구독 중인 플랜' : '이 플랜 선택'}</span>
                  {!isCurrent && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
