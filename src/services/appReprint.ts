import { touchLabelNumber } from './touchSaleModes.ts';
import { sellingSummary } from './appShellState.ts';

/** 판매 앱의 [관리] 탭에서 전표(라벨)를 다시 출력한다. */
export type ReprintSale = {
  id: string;
  buyerNickname: string;
  amount: number;
  productName?: string;
  touchSale?: boolean;
  revision?: number;
};

export type ReprintPrinter = {
  readonly connected: boolean;
  reconnect(): Promise<boolean>;
  send(data: Uint8Array): Promise<void>;
};

export type ReprintDeps = {
  /** 서버의 판매 실행 상태(touch-bootstrap). */
  bootstrap(): Promise<{ run?: Parameters<typeof sellingSummary>[0]; serverNow?: number }>;
  /** 서버 인쇄 대기열에 넣는다(판매 중인 [판매] 탭이 차례로 출력). */
  queueReprint(sale: ReprintSale): Promise<void>;
  /** 직접 출력한 결과를 서버 기록에 남긴다. 실패해도 출력 자체에는 영향이 없다. */
  recordPrint?(saleId: string, result: 'SUCCESS' | 'FAILED'): Promise<unknown>;
  printer: ReprintPrinter;
  label(content: { buyer: string; amount: number; productLabel?: string }): Uint8Array;
};

export const PRINTER_NOT_CONNECTED = 'PRINTER_NOT_CONNECTED';

export class PrinterNotConnectedError extends Error {
  code: string;
  constructor() {
    super('프린터가 연결되어 있지 않습니다. 프린터를 연결해 주세요.');
    this.code = PRINTER_NOT_CONNECTED;
  }
}

/**
 * 판매 중이면 서버 대기열에 넣어 [판매] 탭이 새 판매 전표와 차례로 출력하게 한다(두 탭이 한 프린터를 동시에 쓰지 않도록).
 * 판매 중이 아니면 이 탭이 폰 프린터로 바로 출력한다.
 */
export async function reprintInApp(
  sale: ReprintSale,
  deps: ReprintDeps,
): Promise<'QUEUED' | 'PRINTED'> {
  let selling = false;
  try {
    const boot = await deps.bootstrap();
    selling = !!sellingSummary(boot.run, boot.serverNow);
  } catch {
    // 상태를 못 읽으면 직접 출력을 시도한다. 판매 중이면 프린터가 바쁘다는 오류로 끝난다.
  }
  if (selling && sale.touchSale) {
    await deps.queueReprint(sale);
    return 'QUEUED';
  }
  if (!deps.printer.connected && !(await deps.printer.reconnect())) throw new PrinterNotConnectedError();
  const n = touchLabelNumber(sale.productName);
  const bytes = deps.label({
    buyer: sale.buyerNickname,
    amount: sale.amount,
    productLabel: n !== null ? `${n}번` : undefined,
  });
  try {
    await deps.printer.send(bytes);
  } catch (error) {
    await record(deps, sale, 'FAILED');
    throw error;
  }
  await record(deps, sale, 'SUCCESS');
  return 'PRINTED';
}

/** 서버 기록은 부가 기능이라 오류가 나도(판매 전표가 아닌 일반 판매, 서버 미배포, 오프라인) 출력 결과를 바꾸지 않는다. */
async function record(deps: ReprintDeps, sale: ReprintSale, result: 'SUCCESS' | 'FAILED') {
  if (!deps.recordPrint || !sale.touchSale) return;
  try {
    await deps.recordPrint(sale.id, result);
  } catch {
    // 기록만 빠진다.
  }
}
