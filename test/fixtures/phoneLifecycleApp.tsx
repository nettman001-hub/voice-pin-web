import React from 'react';
import { createRoot } from 'react-dom/client';
import TouchMobileSalesPage from '../../src/pages/seller/TouchMobileSalesPage';
import { phoneLifecycleState, TouchSalesApi } from './phoneLifecycleMock';
import { touchLocalStore } from '../../src/services/touchLocalStore';
import { TouchPcPrintRelay } from '../../src/services/touchPcPrintRelay';

const emit = (type: string, requestId: string) =>
  window.dispatchEvent(new CustomEvent('voicecap-android', { detail: { type, requestId, ok: true } }));
const params = new URLSearchParams(location.search);
phoneLifecycleState.printerConnected = !params.has('remembered');
phoneLifecycleState.captureFrameDelayMs = params.has('slowCapture') ? 3000 : 0;
phoneLifecycleState.cameraError = params.has('cameraError') ? '카메라 권한이 필요합니다.' : '';
phoneLifecycleState.commitError = params.has('pending') ? 'DATABASE_ERROR' : '';
(window as any).VoiceCapAndroid = {
  info: () => '{"version":"fixture"}',
  printerState: () => JSON.stringify({ connected: phoneLifecycleState.printerConnected, name: phoneLifecycleState.printerName, saved: phoneLifecycleState.printerSaved }),
  printerPick: (id: string) => {
    phoneLifecycleState.printerPicks++;
    phoneLifecycleState.printerName = phoneLifecycleState.nextPrinterName;
    phoneLifecycleState.printerSavedName = phoneLifecycleState.printerName;
    phoneLifecycleState.printerSaved = phoneLifecycleState.printerConnected = true;
    emit('printer-connected', id);
  },
  printerConnectLast: (id: string) => {
    phoneLifecycleState.printerReconnects++;
    phoneLifecycleState.printerName = phoneLifecycleState.printerSavedName;
    phoneLifecycleState.printerConnected = true;
    emit('printer-connected', id);
  },
  printerSend: (id: string, data: string) => {
    phoneLifecycleState.nativeWrites++;
    phoneLifecycleState.nativePayloads.push(data);
    if (phoneLifecycleState.nativeSendDelayMs) setTimeout(() => emit('printer-sent', id), phoneLifecycleState.nativeSendDelayMs);
    else emit('printer-sent', id);
  },
  printerDisconnect: () => { phoneLifecycleState.printerDisconnects++; phoneLifecycleState.printerConnected = false; }, selling: (on: boolean) => phoneLifecycleState.nativeSelling.push(on),
  saveFile: () => {}, shareFile: () => {},
};
class FixtureSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close() {}
  constructor() {
    phoneLifecycleState.stream = this;
    queueMicrotask(() => this.onopen?.());
  }
}
(window as any).WebSocket = FixtureSocket;
const root = createRoot(document.getElementById('root')!);
let seededSale: any = null;
if (params.has('buyerChange')) {
  phoneLifecycleState.sales.push({
    id: 'buyer-change-sale', sessionId: phoneLifecycleState.session,
    buyerId: phoneLifecycleState.buyers[2].id, buyerNickname: '꽃미',
    amount: 15000, unitPrice: 15000, quantity: 1,
    recognizedAt: new Date().toISOString(), status: '자동저장',
    printStatus: 'PRINTED', captureStatus: 'CAPTURED', captureDueAt: new Date().toISOString(),
    revision: 1, recordState: 'ACTIVE', history: [],
    comment: { platformMessageId: 'buyer-change-comment', nickname: '꽃미', content: '저요', capturedAt: new Date().toISOString() },
  });
}
if (params.has('blocked') || params.has('pending')) {
  seededSale = {
    operationId: crypto.randomUUID(), sessionId: phoneLifecycleState.session,
    comment: { platformMessageId: 'blocked-comment', nickname: '이전고객', content: '저요', capturedAt: new Date().toISOString() },
    inputPrice: '1.5', unitPrice: 15000, quantity: 1,
    confirmedAt: new Date(Date.now() - 1000).toISOString(), clientConfirmedAt: new Date(Date.now() - 1000).toISOString(), clockOffsetMs: 0,
  };
  await touchLocalStore.putOutbox({
    id: `${phoneLifecycleState.workspace}:${seededSale.operationId}`, workspaceId: phoneLifecycleState.workspace,
    sale: seededSale, createdAt: Date.now(), blocked: !params.has('pending'),
    code: params.has('pending') ? 'DATABASE_ERROR' : 'TOUCH_NOT_RUNNING',
    error: params.has('pending') ? 'fixture database rejection' : 'PC에서 댓글터치 판매 시작을 눌러 주세요.',
  });
}
let printRelay: TouchPcPrintRelay | null = null;
(window as any).phoneLifecycle = {
  state: phoneLifecycleState,
  seededSale,
  outbox: () => touchLocalStore.listOutbox(phoneLifecycleState.workspace),
  async startRelay() {
    if (printRelay?.running) return;
    printRelay = new TouchPcPrintRelay({
      api: new TouchSalesApi(phoneLifecycleState.workspace),
      relayId: '44444444-4444-4444-8444-444444444444',
      readiness: () => ({ ready: phoneLifecycleState.helperConnected, verified: true,
        printerName: 'PC fixture printer', message: 'PC fixture printer · 자동 출력 준비됨' }),
      connected: () => phoneLifecycleState.helperConnected,
      print: async (payload) => {
        phoneLifecycleState.helperPrints.push(structuredClone(payload));
        if (phoneLifecycleState.helperHold)
          await new Promise<void>(resolve => { phoneLifecycleState.helperRelease = resolve; });
        return { ...phoneLifecycleState.helperResult };
      },
      onStatus: (status) => { phoneLifecycleState.relayStatus = status; },
      onError: (error) => { phoneLifecycleState.relayErrors.push(String(error)); },
      onChange: () => {},
    });
    await printRelay.start();
  },
  stopRelay: () => printRelay?.stop(),
  wakeRelay: () => printRelay?.wake(),
  releaseHelper() {
    phoneLifecycleState.helperHold = false;
    phoneLifecycleState.helperRelease?.();
    phoneLifecycleState.helperRelease = null;
  },
  releaseBuyerSearch(query: string) {
    phoneLifecycleState.buyerSearchHolds.delete(query);
    phoneLifecycleState.buyerSearchReleases.get(query)?.();
    phoneLifecycleState.buyerSearchReleases.delete(query);
  },
  comment(id = 'comment-1', nickname = '꽃미', content = '저 그거두') {
    phoneLifecycleState.stream?.onmessage?.({ data: JSON.stringify({
      messages: [{ type: 'WebcastChatMessage', data: { common: { msgId: id }, content, user: { userId: `user-${id}`, uniqueId: id, nickname } } }],
    }) });
  },
  unmount: () => root.unmount(),
};
root.render(<TouchMobileSalesPage />);
