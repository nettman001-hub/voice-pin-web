import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/** 새 관리 화면의 하위 메뉴에서 이전 화면으로 돌아간다. 직접 연 주소는 관리 홈으로 간다. */
export const ManageBackLink: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!pathname.startsWith('/manage/') || (!compact && pathname.startsWith('/manage/orders/'))) return null;

  const goBack = () => {
    const index = window.history.state?.idx;
    if (typeof index === 'number' && index > 0) navigate(-1);
    else navigate(pathname.startsWith('/manage/orders/') ? '/manage/orders' : '/manage');
  };

  return (
    <div className={compact ? 'flex-shrink-0' : 'mx-auto max-w-lg px-3 pt-2 lg:max-w-7xl'}>
      <button
        type="button"
        onClick={goBack}
        className={compact
          ? 'inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 active:bg-slate-100'
          : 'inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm active:bg-slate-100'}
        aria-label="이전 화면으로"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />{!compact && ' 뒤로가기'}
      </button>
    </div>
  );
};
