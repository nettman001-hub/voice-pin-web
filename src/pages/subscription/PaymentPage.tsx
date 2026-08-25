import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { SUBSCRIPTION_PLANS, useAppData } from '../../context/AppDataContext';
import { CreditCard, ShieldCheck, ArrowLeft, CheckCircle2, Lock } from 'lucide-react';

export const PaymentPage: React.FC = () => {
  const { selectedPlanForCheckout, processPayment } = useAppData();
  const navigate = useNavigate();

  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242');
  const [expiry, setExpiry] = useState('12/28');
  const [cvc, setCvc] = useState('888');
  const [cardHolder, setCardHolder] = useState('홍길동');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === selectedPlanForCheckout) || SUBSCRIPTION_PLANS[1];

  const handlePayment = (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);

    setTimeout(() => {
      setIsProcessing(false);
      processPayment({
        cardNumberMasked: cardNumber,
        expiryMonthYear: expiry,
        cvc,
        birthDate: '900101'
      });
      setIsDone(true);
      setTimeout(() => {
        navigate('/subscription/manage');
      }, 2000);
    }, 1500);
  };

  return (
    <div className="p-3.5 sm:p-6 max-w-lg mx-auto space-y-4 sm:space-y-6">
      <Link to="/subscription/plans" className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center space-x-1">
        <ArrowLeft className="w-3.5 h-3.5 mr-1" />
        <span>요금제 선택으로 돌아가기</span>
      </Link>

      <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900">구독 결제</h2>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">{plan.name} 플랜 결제</p>
          </div>
          <div className="text-right">
            <span className="text-lg sm:text-xl font-black text-brand-600">{plan.priceMonth.toLocaleString()}원</span>
            <span className="text-[10px] text-slate-400 block">/ 월 (부가세 포함)</span>
          </div>
        </div>

        {isDone ? (
          <div className="p-6 sm:p-8 text-center space-y-3 sm:space-y-4">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto animate-bounce">
              <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-900">결제가 완료되었습니다! 🎉</h3>
            <p className="text-xs text-slate-500">구독 관리 페이지로 자동 이동합니다...</p>
          </div>
        ) : (
          <form onSubmit={handlePayment} className="space-y-3.5 sm:space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">카드 번호</label>
              <div className="relative">
                <CreditCard className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="0000 0000 0000 0000"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">유효기간 (MM/YY)</label>
                <input
                  type="text"
                  required
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  placeholder="MM/YY"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">CVC (3자리)</label>
                <input
                  type="password"
                  required
                  maxLength={3}
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value)}
                  placeholder="•••"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">카드 소유자 이름</label>
              <input
                type="text"
                required
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value)}
                placeholder="홍길동"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center space-x-2 text-[10px] sm:text-[11px] text-slate-500">
              <Lock className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>SSL 256비트 암호화 결제 엔진으로 안전하게 보호됩니다.</span>
            </div>

            <button
              type="submit"
              disabled={isProcessing}
              className="w-full py-3.5 sm:py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs sm:text-sm shadow-md shadow-brand-500/20 transition active:scale-95 disabled:opacity-50"
            >
              {isProcessing ? '결제 승인 처리 중...' : `${plan.priceMonth.toLocaleString()}원 결제하기`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
