import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SUBSCRIPTION_PLANS } from '../../context/AppDataContext';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import { Check, Sparkles, Zap, Shield, ArrowRight } from 'lucide-react';

export const PricingPage: React.FC = () => {
  const { currentPlan, setSelectedPlanForCheckout } = useAppData();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleSelectPlan = (planId: '베이직' | '프로' | '프리미엄') => {
    setSelectedPlanForCheckout(planId);
    if (!isAuthenticated) {
      navigate('/signup');
    } else {
      navigate('/subscription/payment');
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto text-center">
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/30 text-brand-300 text-xs font-semibold mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          <span>모든 신규 가입자 7일 무료 체험 제공</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-black tracking-tight">
          합리적인 구독 요금제로<br />
          <span className="bg-gradient-to-r from-brand-400 via-tiktok-cyan to-tiktok-pink bg-clip-text text-transparent">
            방송 판매 정산 시간을 90% 단축
          </span>
          하세요.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
          Deepgram Nova-3 실시간 STT, 댓글창 영역 자동 캡처, 판매 DB 적재 및 CSV 정산까지 필요한 플랜을 선택하세요.
        </p>

        {/* 요금제 카드 그리드 */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          {SUBSCRIPTION_PLANS.map((plan) => {
            const isCurrent = isAuthenticated && currentPlan === plan.id;

            return (
              <div
                key={plan.id}
                className={`relative rounded-3xl p-8 flex flex-col justify-between transition transform hover:-translate-y-1 ${
                  plan.isPopular
                    ? 'bg-gradient-to-b from-slate-900 via-slate-900 to-brand-950/40 border-2 border-brand-500 shadow-2xl shadow-brand-500/20'
                    : 'bg-slate-900/80 border border-slate-800'
                }`}
              >
                {plan.isPopular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-brand-600 to-tiktok-pink text-white text-[11px] font-black uppercase tracking-wider shadow-md">
                    가장 인기 있는 플랜
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                    {isCurrent && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                        현재 플랜
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex items-baseline">
                    <span className="text-4xl font-black text-white">{plan.priceMonth.toLocaleString()}</span>
                    <span className="text-sm font-semibold text-slate-400 ml-1">원 / 월</span>
                  </div>

                  <div className="mt-6 space-y-2 text-xs text-slate-300 border-t border-slate-800/80 pt-6">
                    <div className="flex justify-between py-1 border-b border-slate-800/40">
                      <span className="text-slate-400">음성 인식 시간</span>
                      <span className="font-bold text-white">{plan.voiceHours}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/40">
                      <span className="text-slate-400">판매 내역 저장</span>
                      <span className="font-bold text-white">{plan.salesCapacity}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/40">
                      <span className="text-slate-400">화면 캡처</span>
                      <span className="font-bold text-white">{plan.captureCapacity}</span>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2.5">
                    <p className="text-xs font-bold text-slate-200">포함된 기능:</p>
                    {plan.features.map((feat, idx) => (
                      <div key={idx} className="flex items-start text-xs text-slate-300 space-x-2">
                        <Check className="w-4 h-4 text-brand-400 flex-shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-800">
                  <button
                    onClick={() => handleSelectPlan(plan.id)}
                    disabled={isCurrent}
                    className={`w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition ${
                      isCurrent
                        ? 'bg-slate-800 text-slate-400 cursor-default'
                        : plan.isPopular
                        ? 'bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white shadow-lg shadow-brand-500/30'
                        : 'bg-slate-800 hover:bg-slate-700 text-white'
                    }`}
                  >
                    <span>{isCurrent ? '이용 중인 플랜' : `${plan.id} 선택하기`}</span>
                    {!isCurrent && <ArrowRight className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
