import { useRef, useState } from 'react';
import { useRuntimeAuth as useAuth } from '../../context/WorkspaceRuntimeContext';
import { useSales } from '../../context/SalesContext';
import { createPhonePrinter, saleLabelBytes } from '../../services/labelPrinter/phonePrinter';
import { PRINTER_NOT_CONNECTED, reprintInApp, type ReprintSale } from '../../services/appReprint';
import { TouchSalesApi } from '../../services/touchSalesApi';

export type PrintState = { state: 'working' | 'ok' | 'queued' | 'failed' | 'needConnect'; message: string };

/**
 * 판매 앱의 [관리] 탭에서 전표를 폰 프린터로 다시 출력한다(판매내역 상세와 목록 메뉴가 함께 쓴다).
 * 판매 중이면 서버 대기열을 거쳐 [판매] 탭이 새 판매 전표와 차례로 출력하고,
 * 아니면 이 탭이 바로 출력한 뒤 그 결과를 서버 기록에 남긴다.
 */
export function useAppReprint() {
  const { workspaceId } = useAuth();
  const { refreshSales } = useSales();
  const printerRef = useRef<ReturnType<typeof createPhonePrinter> | null>(null);
  const [result, setResult] = useState<PrintState | null>(null);

  const run = async (sale: ReprintSale, connectFirst = false) => {
    if (!workspaceId) return;
    const printer = (printerRef.current ||= createPhonePrinter());
    const api = new TouchSalesApi(workspaceId);
    setResult({ state: 'working', message: connectFirst ? '판매 상태를 확인한 뒤 프린터를 고릅니다…' : '출력하는 중…' });
    try {
      const mode = await reprintInApp(
        sale,
        {
          bootstrap: () => api.bootstrap(),
          queueReprint: async (target) => {
            await api.update({ saleId: target.id, expectedRevision: target.revision || 1, kind: 'REPRINT' });
          },
          beginDirect: (target) => api.beginDirectPrint(target.id, target.revision),
          finishDirect: (ticket, printResult) => api.finishDirectPrint(ticket.jobId, ticket.leaseToken, printResult),
          printer,
          label: (content) => saleLabelBytes(content),
        },
        { connectFirst },
      );
      if (mode !== 'QUEUED') void refreshSales().catch(() => {});
      setResult(
        mode === 'QUEUED'
          ? { state: 'queued', message: '판매 중이라 [판매] 탭이 새 판매 전표와 차례로 출력합니다.' }
          : mode === 'PRINTED_UNRECORDED'
            ? { state: 'ok', message: `프린터(${printer.name || '연결됨'})로 출력했지만 서버 기록을 남기지 못했습니다. 판매내역에는 잠시 뒤 "출력 여부 확인 필요"로 보일 수 있습니다.` }
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

  return { result, run, working: result?.state === 'working' };
}
