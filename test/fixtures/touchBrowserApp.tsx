import React from 'react';
import { createRoot } from 'react-dom/client';
import TouchMobileSalesPage from '../../src/pages/seller/TouchMobileSalesPage';
import { TouchSalesBridge } from '../../src/services/touchSalesBridge';
import { mockState } from './touchBrowserMock';
let pc = new TouchSalesBridge({
  workspaceId: mockState.workspace,
  role: 'PC',
  onPacket: () => {},
});
mockState.bridge = pc;
pc.setPcState({
  running: true,
  producerId: pc.id,
  sessionId: mockState.session,
  displayCode: '2026-10-21 라이브 1회차',
  helperConnected: true,
  commentStatus: 'COLLECTING',
  screenConnected: true,
  printerConnected: true,
  delaySeconds: 5,
  delaySource: 'SETTING',
  prepareSeconds: 4,
  product: null,
  totalCount: 0,
  totalAmount: 0,
});
const add = (id: string, nickname: string, content: string) =>
  pc.publish([
    {
      id,
      platformMessageId: id,
      platformUserId: 'account-' + id,
      uniqueId: id,
      sessionId: mockState.session,
      nickname,
      content,
      capturedAt: new Date().toISOString(),
      sequence: 0,
      stats:
        id === 'a'
          ? {
              purchaseCount: 12,
              purchaseSessionCount: 4,
              totalPurchaseCount: 13,
              totalRevenue: 455000,
              defaultCount: 0,
              todayCount: 1,
              isFirstTimeBuyer: false,
            }
          : id === 'b'
            ? {
                purchaseCount: 3,
                purchaseSessionCount: 2,
                totalPurchaseCount: 3,
                totalRevenue: 76000,
                defaultCount: 1,
                todayCount: 0,
                isFirstTimeBuyer: false,
              }
            : undefined,
    },
  ]);
await pc.start();
add('a', '초코맘', '저요');
add('talk', '해피데이', '사이즈 55도 있어요?');
add('b', '라임', 'ㅈㅇ');
add('c', '구름빵', '제가 살게요');
(window as any).touchTest = {
  state: mockState,
  pc,
  add,
  forceFallback: () => {
    pc['peer']?.close();
    pc['data']?.close();
  },
  restartPc: async () => {
    const state = (pc as any).pcState;
    pc.stop();
    pc = new TouchSalesBridge({
      workspaceId: mockState.workspace,
      role: 'PC',
      onPacket: () => {},
    });
    pc.setPcState({ ...state, producerId: pc.id });
    mockState.bridge = pc;
    (window as any).touchTest.pc = pc;
    await pc.start();
    add('restarted', '다시연결', '저요');
  },
  useBlockedRtc: () => {
    (window as any).RTCPeerConnection = class {
      constructor() {
        throw new Error('fixture blocks WebRTC');
      }
    };
  },
};
createRoot(document.getElementById('root')!).render(<TouchMobileSalesPage />);
