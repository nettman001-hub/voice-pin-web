import React from 'react';
import { createRoot } from 'react-dom/client';
import TouchMobileSalesPage from '../../src/pages/seller/TouchMobileSalesPage';
import { phoneLifecycleState } from './phoneLifecycleMock';
import { touchLocalStore } from '../../src/services/touchLocalStore';

const emit = (type: string, requestId: string) =>
  window.dispatchEvent(new CustomEvent('voicecap-android', { detail: { type, requestId, ok: true } }));
(window as any).VoiceCapAndroid = {
  info: () => '{"version":"fixture"}',
  printerState: () => '{"connected":true,"name":"M50-fixture"}',
  printerPick: (id: string) => emit('printer-connected', id),
  printerConnectLast: (id: string) => emit('printer-connected', id),
  printerSend: (id: string) => { phoneLifecycleState.nativeWrites++; emit('printer-sent', id); },
  printerDisconnect: () => {}, selling: (on: boolean) => phoneLifecycleState.nativeSelling.push(on),
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
if (new URLSearchParams(location.search).has('blocked')) {
  seededSale = {
    operationId: crypto.randomUUID(), sessionId: phoneLifecycleState.session,
    comment: { platformMessageId: 'blocked-comment', nickname: '이전고객', content: '저요', capturedAt: new Date().toISOString() },
    inputPrice: '1.5', unitPrice: 15000, quantity: 1,
    confirmedAt: new Date(Date.now() - 1000).toISOString(), clientConfirmedAt: new Date(Date.now() - 1000).toISOString(), clockOffsetMs: 0,
  };
  await touchLocalStore.putOutbox({
    id: `${phoneLifecycleState.workspace}:${seededSale.operationId}`, workspaceId: phoneLifecycleState.workspace,
    sale: seededSale, createdAt: Date.now(), blocked: true, code: 'TOUCH_NOT_RUNNING', error: 'PC에서 댓글터치 판매 시작을 눌러 주세요.',
  });
}
(window as any).phoneLifecycle = {
  state: phoneLifecycleState,
  seededSale,
  outbox: () => touchLocalStore.listOutbox(phoneLifecycleState.workspace),
  comment(id = 'comment-1', nickname = '꽃미', content = '저 그거두') {
    phoneLifecycleState.stream?.onmessage?.({ data: JSON.stringify({
      messages: [{ type: 'WebcastChatMessage', data: { common: { msgId: id }, content, user: { userId: `user-${id}`, uniqueId: id, nickname } } }],
    }) });
  },
  unmount: () => root.unmount(),
};
root.render(<TouchMobileSalesPage />);
