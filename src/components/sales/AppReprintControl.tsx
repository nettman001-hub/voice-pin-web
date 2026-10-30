import React from 'react';
import { Printer, RotateCw } from 'lucide-react';
import { isSalesApp } from '../../services/labelPrinter/androidBridge';
import { type ReprintSale } from '../../services/appReprint';
import { useAppReprint } from './useAppReprint';

/**
 * 판매 앱의 [관리] 탭: 전표를 폰 프린터로 다시 출력한다. 판매 중이면 서버 대기열을 거쳐 [판매] 탭이 새 판매 전표와 차례로 출력한다.
 * 판매 앱이 아니면 기존 화면(fallback)을 그대로 보여 준다.
 */
export const AppReprintControl: React.FC<{
  sale: ReprintSale & { printStatus?: string; printError?: string };
  fallback: React.ReactNode;
}> = ({ sale, fallback }) => {
  const { result, run, working } = useAppReprint();
  if (!isSalesApp()) return <>{fallback}</>;

  const failed = sale.printStatus === 'FAILED';
  const tone = result?.state === 'failed' ? 'text-rose-700' : result?.state === 'ok' || result?.state === 'queued' ? 'text-emerald-700' : 'text-slate-600';
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 ${
        failed ? 'border-rose-200 bg-rose-50' : sale.printStatus === 'PRINTED' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
      }`}
    >
      <div className="flex items-center gap-2 text-xs">
        <Printer className={`h-4 w-4 ${failed ? 'text-rose-600' : 'text-brand-600'}`} />
        <span className="font-bold text-slate-800">
          {sale.printStatus === 'PRINTED'
            ? '판매 전표 출력 완료'
            : sale.printStatus === 'QUEUED'
              ? '판매 전표 출력 중...'
              : failed
                ? `출력 실패: ${sale.printError || '프린터 연결을 확인해 주세요.'}`
                : '판매 전표 출력 대기'}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void run(sale)}
        disabled={working}
        className="flex min-h-[44px] items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-brand-700 disabled:opacity-50"
      >
        <RotateCw className="h-3.5 w-3.5" />
        {failed ? '다시 출력' : '전표 다시 출력'}
      </button>
      {result && (
        <div role="status" className={`basis-full text-xs font-bold ${tone}`}>
          {result.message}
          {result.state === 'needConnect' && (
            <button
              type="button"
              onClick={() => void run(sale, true)}
              className="ml-2 min-h-[40px] rounded-lg bg-brand-600 px-3 py-1.5 text-white"
            >
              프린터 연결 후 출력
            </button>
          )}
        </div>
      )}
    </div>
  );
};
