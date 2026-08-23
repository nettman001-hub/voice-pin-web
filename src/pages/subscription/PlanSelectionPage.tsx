import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SUBSCRIPTION_PLANS, useAppData } from '../../context/AppDataContext';
import { Sparkles, Check, ArrowRight } from 'lucide-react';

export const PlanSelectionPage: React.FC = () => {
  const { currentPlan, setSelectedPlanForCheckout } = useAppData();
  const navigate = useNavigate();

  const handleChoose = (planId: '베이직' | '프로' | '프리미엄') => {
    setSelectedPlanForCheckout(planId);
    navigate('/subscription/payment');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-bold shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-brand-600" />
          <span>구독 플랜 선택</span>
        </div>
        <h1 className="text-3xl font-black text-slate-900">맞춤형 플랜을 선택하세요</h1>
        <p className="text-xs text-slate-500 max-w-xl mx-auto">
          방송 규모와 판매량에 맞는 요금제를 선택해 판매 정산의 번거로움을 완전히 해결하세요.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id;

          return (
            <div
              key={plan.id}
              className={`relative rounded-3xl p-6 bg-white border flex flex-col justify-between transition transform hover:-translate-y-1 ${
                plan.isPopular
                  ? 'border-2 border-brand-500 shadow-xl shadow-brand-500/10'
                  : 'border-slate-200 shadow-sm'
              }`}
            >
              {plan.isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-brand-600 text-white text-[10px] font-black uppercase shadow-sm">
                  인기 추천
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                  {isCurrent && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                      현재 이용 중
                    </span>
                  )}
                </div>

                <div className="mt-4 flex items-baseline">
                  <span className="text-3xl font-black text-slate-900">{plan.priceMonth.toLocaleString()}</span>
                  <span className="text-xs text-slate-500 ml-1">원 / 월</span>
                </div>

                <div className="mt-6 space-y-2 text-xs text-slate-700 border-t border-slate-100 pt-4">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">인식 시간</span>
                    <span className="font-bold text-slate-900">{plan.voiceHours}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">판매 저장</span>
                    <span className="font-bold text-slate-900">{plan.salesCapacity}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">화면 캡처</span>
                    <span className="font-bold text-slate-900">{plan.captureCapacity}</span>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-xs font-bold text-slate-900">제공 기능:</p>
                  {plan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-start text-xs text-slate-600 space-x-2">
                      <Check className="w-3.5 h-3.5 text-brand-600 flex-shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100">
                <button
                  onClick={() => handleChoose(plan.id)}
                  disabled={isCurrent}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition ${
                    isCurrent
                      ? 'bg-slate-100 text-slate-400 cursor-default'
                      : plan.isPopular
                      ? 'bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-500/20'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                  }`}
                >
                  <span>{isCurrent ? '이용 중인 플랜' : '이 플랜으로 변경 / 결제'}</span>
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
