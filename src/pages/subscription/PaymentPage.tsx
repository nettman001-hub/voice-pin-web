import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData, SUBSCRIPTION_PLANS } from '../../context/AppDataContext';
import { CreditCard, Lock, ShieldCheck, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';

export const PaymentPage: React.FC = () => {
  const { selectedPlanForCheckout, processPayment } = useAppData();
  const navigate = useNavigate();

  const selectedPlan = SUBSCRIPTION_PLANS.find((p) => p.id === selectedPlanForCheckout) || SUBSCRIPTION_PLANS[1];

  const [cardNumber, setCardNumber] = useState('4820-1234-5678-9012');
  const [expiry, setExpiry] = useState('08/29');
  const [cvc, setCvc] = useState('789');
  const [birthDate, setBirthDate] = useState('900101');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsProcessing(true);

    setTimeout(() => {
      const res = processPayment({
        cardNumberMasked: cardNumber,
        expiryMonthYear: expiry,
        cvc,
        birthDate
      });

      setIsProcessing(false);
      if (!res.success) {
        setErrorMsg(res.message || '결제 처리에 실패했습니다.');
      } else {
        navigate('/subscription/manage');
      }
    }, 1200);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <button
        onClick={() => navigate('/subscription/plans')}
        className="flex items-center space-x-1 text-xs text-slate-400 hover:text-white transition"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>요금제 선택으로 돌아가기</span>
      </button>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        <div>
          <h2 className="text-2xl font-black text-white">결제 수단 등록 & 정기 결제</h2>
          <p className="text-xs text-slate-400 mt-1">안전한 결제 대행사를 통해 첫 정기 구독이 시작됩니다.</p>
        </div>

        {/* 선택한 플랜 요약 */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400">선택한 요금제</span>
            <div className="text-base font-bold text-white mt-0.5">{selectedPlan.name}</div>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400">월 정기 결제액</span>
            <div className="text-xl font-black text-brand-400 mt-0.5">{selectedPlan.priceMonth.toLocaleString()}원</div>
          </div>
        </div>

        {errorMsg && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 카드 입력 폼 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">카드 번호 (16자리)</label>
            <div className="relative">
              <CreditCard className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                required
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                placeholder="0000-0000-0000-0000"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">유효기간</label>
              <input
                type="text"
                required
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                placeholder="MM/YY"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 text-center focus:outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">CVC (3자리)</label>
              <input
                type="password"
                required
                maxLength={3}
                value={cvc}
                onChange={(e) => setCvc(e.target.value)}
                placeholder="789"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 text-center focus:outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">생년월일 (6자리)</label>
              <input
                type="text"
                required
                maxLength={6}
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                placeholder="900101"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 text-center focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center space-x-2 text-[11px] text-slate-400">
            <Lock className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>모든 결제 정보는 256bit SSL 암호화되어 안전하게 처리됩니다.</span>
          </div>

          <button
            type="submit"
            disabled={isProcessing}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 text-white font-bold text-sm shadow-xl shadow-brand-500/25 transition disabled:opacity-50"
          >
            {isProcessing ? '결제 승인 진행 중...' : `${selectedPlan.priceMonth.toLocaleString()}원 결제 승인하기`}
          </button>
        </form>
      </div>
    </div>
  );
};
