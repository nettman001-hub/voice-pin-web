import React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { withManageScope } from '../../services/manage/scope';
import { readManagePeriod } from '../../services/manage/period';
import { ArrowLeft } from 'lucide-react';

/** 각 관리 화면의 첫 버튼 줄에서 쓰는 뒤로가기. 직접 연 주소는 상위 화면으로 간다. */
export const ManageBackLink: React.FC<{ fallback?: string }> = ({ fallback }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const goBack = () => {
    const index = window.history.state?.idx;
    if (typeof index === 'number' && index > 0) navigate(-1);
    else {
      const target = fallback || (pathname.startsWith('/manage/orders/') ? '/manage/orders' : '/manage');
      const scope = params.has('session') ? { mode: 'session' as const, sessionId: params.get('session')! }
        : params.has('period') ? { mode: 'period' as const, periodDays: readManagePeriod(params.get('period')) } : null;
      navigate(scope ? withManageScope(target, scope) : target);
    }
  };

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 active:bg-slate-100"
      aria-label="뒤로가기"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
    </button>
  );
};
