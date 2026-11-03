export const LABEL_PAPERS = {
  '50x30': { widthMm: 50, heightMm: 30, widthPx: 384, heightPx: 240 },
  '40x25': { widthMm: 40, heightMm: 25, widthPx: 320, heightPx: 200 },
  '40x30': { widthMm: 40, heightMm: 30, widthPx: 320, heightPx: 240 },
} as const;
export type LabelPaperSize = keyof typeof LABEL_PAPERS;
export const normalizePaperSize = (value: unknown): LabelPaperSize =>
  value === '40x25' || value === '40x30' ? value : '50x30';

type PrinterIdentity = { readonly model?: string; readonly deviceId?: string; readonly name: string };
const paperKey = (workspaceId: string, printer: PrinterIdentity) =>
  `voicecap-phone-paper:${workspaceId}:${printer.model || 'M50'}:${printer.deviceId || printer.name}`;

export function readPaperSize(workspaceId: string, printer: PrinterIdentity): LabelPaperSize {
  try { return normalizePaperSize(localStorage.getItem(paperKey(workspaceId, printer))); }
  catch { return '50x30'; }
}

export function savePaperSize(workspaceId: string, printer: PrinterIdentity, value: LabelPaperSize) {
  localStorage.setItem(paperKey(workspaceId, printer), normalizePaperSize(value));
}
