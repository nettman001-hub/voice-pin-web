import React, { useRef, useState } from 'react';
import { Printer, RotateCw } from 'lucide-react';
import { useRuntimeAuth as useAuth } from '../../context/WorkspaceRuntimeContext';
import { isSalesApp } from '../../services/labelPrinter/androidBridge';
import { createPhonePrinter, saleLabelBytes } from '../../services/labelPrinter/phonePrinter';
import { PRINTER_NOT_CONNECTED, reprintInApp, type ReprintSale } from '../../services/appReprint';
import { TouchSalesApi } from '../../services/touchSalesApi';

type PrintState = { state: 'working' | 'ok' | 'queued' | 'failed' | 'needConnect'; message: string };

/**
 * 판매 앱의 [관리] 탭: 전표를 폰 프린터로 다시 출력한다. 판매 중이면 서버 대기열을 거쳐 [판매] 탭이 새 판매 전표와 차례로 출력한다.
 * 판매 앱이 아니면 기존 화면(fallback)을 그대로 보여 준다.
 */
export const AppReprintControl: React.FC<{
  sale: ReprintSale & { printStatus?: string; printError?: string };
  fallback: React.ReactNode;
}> = ({ sale, fallback }) => {
  const { workspaceId } = useAuth();
  const printerRef = useRef<ReturnType<typeof createPhonePrinter> | null>(null);
  const [result, setResult] = useState<PrintState | null>(null);
  if (!isSalesApp()) return <>{fallback}</>;

  const run = async (connectFirst = false) => {
    if (!workspaceId) return;
    const printer = (printerRef.current ||= createPhonePrinter());
    const api = new TouchSalesApi(workspaceId);
    setResult({ state: 'working', message: connectFirst ? '프린터를 고르는 중…' : '출력하는 중…' });
    try {
      if (connectFirst) await printer.connect();
      const mode = await reprintInApp(sale, {
        bootstrap: () => api.bootstrap(),
        queueReprint: async (target) => {
          await api.update({ saleId: target.id, expectedRevision: target.revision || 1, kind: 'REPRINT' });
        },
        printer,
        label: (content) => saleLabelBytes(content),
      });
      setResult(
        mode === 'QUEUED'
          ? { state: 'queued', message: '판매 중이라 [판매] 탭이 새 판매 전표와 차례로 출력합니다.' }
          : { state: 'ok', message: `프린터(${printer.name || '연결됨'})로 출력했습니다.` },
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      setResult(
        code === PRINTER_NOT_CONNECTED
          ? { state: 'needConnect', message: '프린터가 연결되어 있지 않습니다.' }
          : { state: 'failed', message: (error as Error).message || '출력하지 못했습니다.' },
      );
    }
  };

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
        onClick={() => void run()}
        disabled={result?.state === 'working'}
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
              onClick={() => void run(true)}
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
