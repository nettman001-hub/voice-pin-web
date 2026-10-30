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
  /** 프린터 고르기(처음 연결). */
  connect?(): Promise<void>;
  reconnect(): Promise<boolean>;
  send(data: Uint8Array): Promise<void>;
};

/** 서버가 직접 출력 자리를 잡고 돌려준 작업과 최신 판매 내용. */
export type DirectPrintTicket = {
  jobId: string;
  leaseToken: string;
  sale: { buyerNickname: string; amount: number; productName?: string | null };
};

export type ReprintDeps = {
  /** 서버의 판매 실행 상태(touch-bootstrap). */
  bootstrap(): Promise<{ run?: Parameters<typeof sellingSummary>[0]; serverNow?: number }>;
  /** 서버 인쇄 대기열에 넣는다(판매 중인 [판매] 탭이 차례로 출력). */
  queueReprint(sale: ReprintSale): Promise<void>;
  /** 댓글터치 판매: 출력 전에 서버에서 판매 상태·대기 전표를 확인하고 자리를 잡는다. 거절되면 오류를 던진다. */
  beginDirect?(sale: ReprintSale): Promise<DirectPrintTicket>;
  /** 잡아 둔 자리에 출력 결과를 남긴다. */
  finishDirect?(ticket: DirectPrintTicket, result: 'SUCCESS' | 'FAILED'): Promise<unknown>;
  printer: ReprintPrinter;
  label(content: { buyer: string; amount: number; productLabel?: string }): Uint8Array;
};

export const PRINTER_NOT_CONNECTED = 'PRINTER_NOT_CONNECTED';
export const SELLING_STATE_UNKNOWN = 'SELLING_STATE_UNKNOWN';

export class PrinterNotConnectedError extends Error {
  code: string;
  constructor() {
    super('프린터가 연결되어 있지 않습니다. 프린터를 연결해 주세요.');
    this.code = PRINTER_NOT_CONNECTED;
  }
}

export class SellingStateUnknownError extends Error {
  code: string;
  constructor() {
    super('판매 상태를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.');
    this.code = SELLING_STATE_UNKNOWN;
  }
}

/** PRINTED: 출력하고 서버에도 남김. PRINTED_UNRECORDED: 출력은 했지만 서버 기록을 남기지 못함. */
export type ReprintResult = 'QUEUED' | 'PRINTED' | 'PRINTED_UNRECORDED';

/**
 * 1) 댓글터치 판매는 먼저 판매 상태를 읽는다. 판매 중이면 서버 대기열에 넣어 [판매] 탭이 새 판매 전표와 차례로 출력한다.
 *    상태를 못 읽으면 출력하지 않는다(판매 중인데 직접 출력하면 같은 전표가 두 번 나갈 수 있다).
 * 2) 직접 출력할 때만 프린터를 연결한다(판매 중인 [판매] 탭의 프린터 연결을 바꾸지 않도록).
 * 3) 종이를 내기 전에 서버가 취소·수정·대기 전표를 확인하고 자리를 잡으며, 서버의 최신 내용으로 출력한다.
 */
export async function reprintInApp(
  sale: ReprintSale,
  deps: ReprintDeps,
  options: { connectFirst?: boolean } = {},
): Promise<ReprintResult> {
  if (sale.touchSale) {
    let selling: boolean;
    try {
      const boot = await deps.bootstrap();
      selling = !!sellingSummary(boot.run, boot.serverNow);
    } catch {
      throw new SellingStateUnknownError();
    }
    if (selling) {
      await deps.queueReprint(sale);
      return 'QUEUED';
    }
  }

  if (options.connectFirst && deps.printer.connect) await deps.printer.connect();
  else if (!deps.printer.connected && !(await deps.printer.reconnect())) throw new PrinterNotConnectedError();

  const ticket = sale.touchSale && deps.beginDirect ? await deps.beginDirect(sale) : null;
  const content = ticket ? ticket.sale : sale;
  const n = touchLabelNumber(content.productName ?? undefined);
  const bytes = deps.label({
    buyer: content.buyerNickname,
    amount: content.amount,
    productLabel: n !== null ? `${n}번` : undefined,
  });
  try {
    await deps.printer.send(bytes);
  } catch (error) {
    if (ticket) await finish(deps, ticket, 'FAILED');
    throw error;
  }
  if (!ticket) return 'PRINTED';
  return (await finish(deps, ticket, 'SUCCESS')) ? 'PRINTED' : 'PRINTED_UNRECORDED';
}

/** 결과 기록은 한 번 더 시도한다. 그래도 안 되면 서버가 90초 뒤 "출력 여부 확인 필요"로 돌린다. */
async function finish(deps: ReprintDeps, ticket: DirectPrintTicket, result: 'SUCCESS' | 'FAILED') {
  if (!deps.finishDirect) return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await deps.finishDirect(ticket, result);
      return true;
    } catch {
      // 같은 작업 번호로 다시 보내도 서버는 한 번만 기록한다.
    }
  }
  return false;
}
