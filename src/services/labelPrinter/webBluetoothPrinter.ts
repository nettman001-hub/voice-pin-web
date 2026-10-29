import { chunkBytes, parseCredit, toHex } from './marklifeProtocol.ts';

/* Minimal Web Bluetooth types; lib.dom does not ship them. */
type Characteristic = {
  uuid: string;
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
    notify: boolean;
  };
  writeValue?: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
  writeValueWithResponse?: (data: BufferSource) => Promise<void>;
  startNotifications: () => Promise<Characteristic>;
  addEventListener: (type: string, cb: (e: Event) => void) => void;
  value?: DataView;
};
type Service = {
  uuid: string;
  getCharacteristics: () => Promise<Characteristic[]>;
};
type Device = {
  name?: string;
  id: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<{
      getPrimaryServices: () => Promise<Service[]>;
    }>;
    disconnect: () => void;
  };
  addEventListener: (type: string, cb: () => void) => void;
};

// 16-bit services seen on Marklife-family and other cheap BLE printers.
const SERVICE_CANDIDATES = [
  0xff00,
  0xfee7,
  0x18f0,
  0xae30,
  0xae00,
  0xffe0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];
const short = (uuid: string) => uuid.slice(4, 8).toLowerCase();

export const webBluetoothAvailable = () =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export type PrinterLog = (line: string) => void;
export type SendMode = 'AUTO' | 'CREDIT' | 'TIMED';

export class WebBluetoothPrinter {
  private device: Device | null = null;
  private writeChar: Characteristic | null = null;
  private credits = 0;
  private sawCredit = false;
  private creditNotes = 0;
  private waiters: (() => void)[] = [];
  constructor(private log: PrinterLog) {}

  get name() {
    return this.device?.name || '';
  }
  get connected() {
    return !!this.device?.gatt?.connected && !!this.writeChar;
  }
  get creditSeen() {
    return this.sawCredit;
  }

  async connect() {
    if (!webBluetoothAvailable())
      throw new Error(
        '이 브라우저는 블루투스를 쓸 수 없습니다. 폰 Chrome에서 열어 주세요.',
      );
    const bluetooth = (
      navigator as unknown as {
        bluetooth: { requestDevice: (o: unknown) => Promise<Device> };
      }
    ).bluetooth;
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERVICE_CANDIDATES,
    });
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      this.writeChar = null;
      this.log('연결이 끊어졌습니다.');
    });
    this.log(`선택: ${device.name || '(이름 없음)'}`);
    const server = await device.gatt!.connect();
    const services = await server.getPrimaryServices();
    let write: Characteristic | null = null;
    let notify: Characteristic | null = null;
    for (const service of services) {
      const chars = await service.getCharacteristics();
      for (const c of chars) {
        const p = c.properties;
        this.log(
          `서비스 ${short(service.uuid)} · 특성 ${short(c.uuid)}${p.write ? ' write' : ''}${p.writeWithoutResponse ? ' writeNoResp' : ''}${p.notify ? ' notify' : ''}`,
        );
        if (short(c.uuid) === 'ff02' && (p.write || p.writeWithoutResponse))
          write = c;
        if (short(c.uuid) === 'ff03' && p.notify) notify = c;
        if (!write && (p.writeWithoutResponse || p.write)) write = c;
        if (!notify && p.notify && short(c.uuid) !== short(write?.uuid || ''))
          notify = c;
      }
    }
    if (!write)
      throw new Error('쓰기 특성을 찾지 못했습니다. 로그를 보내 주세요.');
    this.writeChar = write;
    this.log(`쓰기: ${short(write.uuid)}`);
    if (notify) {
      await notify.startNotifications();
      notify.addEventListener('characteristicvaluechanged', (e) => {
        const value = (e.target as unknown as Characteristic).value;
        if (!value) return;
        const data = new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        );
        const credit =
          short(notify!.uuid) === 'ff03' ? parseCredit(data) : null;
        if (credit !== null) {
          this.sawCredit = true;
          this.credits += credit;
          this.waiters.splice(0).forEach((w) => w());
          // Credits arrive every few packets; log the first ones and then every 50th.
          if (++this.creditNotes > 3 && this.creditNotes % 50) return;
        }
        this.log(
          `받음 ${short(notify!.uuid)}: ${toHex(data)}${credit !== null ? ` (허용 +${credit})` : ''}`,
        );
      });
      this.log(`알림 받기: ${short(notify.uuid)}`);
    }
  }

  disconnect() {
    this.device?.gatt?.disconnect();
    this.writeChar = null;
  }

  private async writeChunk(chunk: Uint8Array) {
    const c = this.writeChar!;
    const data = new Uint8Array(chunk);
    if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse)
      await c.writeValueWithoutResponse(data);
    else if (c.writeValueWithResponse) await c.writeValueWithResponse(data);
    else await c.writeValue!(data);
  }

  private waitCredit(timeoutMs: number) {
    if (this.credits > 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** AUTO waits for credits once the printer has sent any, otherwise paces by time. */
  async send(
    data: Uint8Array,
    options: { chunkSize?: number; mode?: SendMode; delayMs?: number } = {},
    onProgress?: (sent: number, total: number) => void,
  ) {
    if (!this.connected) throw new Error('프린터가 연결되어 있지 않습니다.');
    const chunks = chunkBytes(data, options.chunkSize ?? 90);
    const mode = options.mode ?? 'AUTO';
    const delayMs = options.delayMs ?? 30;
    const started = performance.now();
    for (let i = 0; i < chunks.length; i++) {
      const useCredit =
        mode === 'CREDIT' || (mode === 'AUTO' && this.sawCredit);
      if (useCredit) {
        const ok = await this.waitCredit(3000);
        if (!ok)
          this.log(
            `허용 신호가 3초 동안 없어 그냥 보냅니다 (${i + 1}/${chunks.length}).`,
          );
        else this.credits--;
      }
      await this.writeChunk(chunks[i]);
      if (!useCredit && delayMs > 0)
        await new Promise((r) => setTimeout(r, delayMs));
      onProgress?.(i + 1, chunks.length);
    }
    const ms = Math.round(performance.now() - started);
    this.log(`보냄 ${data.length}바이트, ${chunks.length}조각, ${ms}ms`);
    return ms;
  }
}
