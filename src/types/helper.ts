export type HelperState = 'starting' | 'running' | 'error';

export type TikTokState = 'idle' | 'connecting' | 'collecting' | 'waiting_live' | 'ended' | 'error';

export type PaperSize = 'LABEL_50_30' | 'RECEIPT_80' | 'RECEIPT_58' | 'A4';

export interface PrinterDevice {
  name: string;
  displayName?: string;
  description?: string;
  status?: number;
  isDefault?: boolean;
}

export interface PrinterInfo extends PrinterDevice {}

export interface PrintSettings {
  enabled: boolean;
  printerName: string;
  paperSize: PaperSize;
  message?: string;
}

export interface SttDeviceInfo {
  id: string;
  name: string;
  isGpu?: boolean;
  type?: string;
  vram?: string | number;
}

export interface SttStatus {
  ok?: boolean;
  provider?: string;
  model?: string;
  device?: string;
  deviceName?: string;
  devices?: SttDeviceInfo[];
  isGpu?: boolean;
  status?: string;
  message?: string;
  error?: string;
}

export interface CommentHelperStatus {
  helper: HelperState;
  message: string;
  tiktokState: TikTokState;
  tiktokUsername: string;
  viewerCount: number;
  totalComments: number;
  lastCheckedAt: string | null;
  version: string;
  autoStart: boolean;
  webAppUrl: string;
  stt: SttStatus | null;
  print: PrintSettings;
}

export interface VoicecapNativeBridge {
  getStatus: () => Promise<CommentHelperStatus>;
  restart: () => Promise<CommentHelperStatus>;
  openWebApp: () => Promise<void>;
  openLogs: () => Promise<void>;
  setAutoStart: (enabled: boolean) => Promise<boolean>;
  getPrinters: () => Promise<PrinterDevice[]>;
  savePrintSettings: (settings: Partial<PrintSettings>) => Promise<PrintSettings>;
  testPrint: () => Promise<{ ok: boolean; status: string; error?: string }>;
  setSttDevice: (device: string) => Promise<SttStatus>;
  detectSttDevices: () => Promise<{ ok: boolean; devices?: SttDeviceInfo[]; error?: string }>;
  hideWindow: () => Promise<void>;
  quit: () => Promise<void>;
  onStatus: (listener: (status: CommentHelperStatus) => void) => () => void;
}

declare global {
  interface Window {
    voicecap?: VoicecapNativeBridge;
  }
}
