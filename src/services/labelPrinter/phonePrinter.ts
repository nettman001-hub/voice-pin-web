import {
  androidJson,
  androidNative,
  bytesToBase64,
  waitAndroid,
} from './androidBridge.ts';
import {
  buildPrintJob,
  marklifeCommands,
  packBitmap,
  type LabelAlign,
} from './marklifeProtocol.ts';
import { drawSaleLabel, type LabelContent } from './labelDraw.ts';
import { WebBluetoothPrinter } from './webBluetoothPrinter.ts';

/** 폰 단독 판매의 라벨 인쇄 기본값. M50 시험(2026-10-29)에서 맞춤은 간격 찾기(GAP)가 잘 맞았다. */
export const PHONE_LABEL_DEFAULTS = {
  density: 3,
  speed: 1,
  align: 'GAP' as LabelAlign,
  threshold: 160,
};

export interface PhoneLabelPrinter {
  readonly name: string;
  readonly connected: boolean;
  /** 처음 연결(기기 고르기). */
  connect(): Promise<void>;
  /** 저장해 둔 프린터에 다시 붙기. 없으면 false. */
  reconnect(): Promise<boolean>;
  send(data: Uint8Array): Promise<void>;
  disconnect(): void;
}

class AndroidLabelPrinter implements PhoneLabelPrinter {
  private state = { connected: false, name: '' };
  private refresh() {
    const native = androidNative();
    this.state = androidJson(native?.printerState(), { connected: false, name: '' });
  }
  get name() {
    this.refresh();
    return this.state.name || '';
  }
  get connected() {
    this.refresh();
    return !!this.state.connected;
  }
  async connect() {
    const id = crypto.randomUUID();
    const wait = waitAndroid('printer-connected', id, 60000);
    androidNative()!.printerPick(id);
    await wait;
  }
  async reconnect() {
    const id = crypto.randomUUID();
    const wait = waitAndroid('printer-connected', id, 20000);
    androidNative()!.printerConnectLast(id);
    try {
      await wait;
      return true;
    } catch {
      return false;
    }
  }
  async send(data: Uint8Array) {
    const id = crypto.randomUUID();
    const wait = waitAndroid('printer-sent', id, 30000);
    androidNative()!.printerSend(id, bytesToBase64(data));
    await wait;
  }
  disconnect() {
    androidNative()?.printerDisconnect();
  }
}

class BrowserLabelPrinter implements PhoneLabelPrinter {
  private printer = new WebBluetoothPrinter(() => {});
  get name() {
    return this.printer.name;
  }
  get connected() {
    return this.printer.connected;
  }
  async connect() {
    await this.printer.connect();
  }
  async reconnect() {
    return false;
  }
  async send(data: Uint8Array) {
    await this.printer.send(data);
  }
  disconnect() {
    this.printer.disconnect();
  }
}

/** 판매 앱 안이면 앱의 블루투스, 아니면 Chrome Web Bluetooth. */
export function createPhonePrinter(): PhoneLabelPrinter {
  return androidNative() ? new AndroidLabelPrinter() : new BrowserLabelPrinter();
}

export function saleLabelBytes(
  content: LabelContent,
  canvas: HTMLCanvasElement = document.createElement('canvas'),
  options: Partial<typeof PHONE_LABEL_DEFAULTS> = {},
) {
  const o = { ...PHONE_LABEL_DEFAULTS, ...options };
  const image = drawSaleLabel(canvas, content);
  const bits = packBitmap(image.data, image.width, image.height, o.threshold);
  return buildPrintJob(bits, {
    density: o.density,
    speed: o.speed,
    align: o.align,
  });
}

/** "라벨 다시 맞추기": 종이 학습(라벨 길이·간격 재기). 처음 연결 때도 한 번 한다. */
export const realignBytes = () => marklifeCommands.learnPaper();
