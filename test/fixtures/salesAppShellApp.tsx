import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SalesAppShell } from '../../src/components/common/SalesAppShell';
import { LoginPage } from '../../src/pages/auth/LoginPage';
import { FixtureAuthProvider, shellDiagnostics, useAuth } from './salesAppShellMock';
import { phoneLifecycleState } from './phoneLifecycleMock';

const initialTab = new URLSearchParams(location.search).get('initialTab') || 'sell';
const emit = (type: string, requestId: string) =>
  window.dispatchEvent(new CustomEvent('voicecap-android', { detail: { type, requestId, ok: true } }));
(window as any).VoiceCapAndroid = {
  info: () => JSON.stringify({ version: 'fixture', singleWebView: true, tab: initialTab }),
  setTab: (tab: string) => shellDiagnostics.tabs.push(tab),
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
  close() { phoneLifecycleState.streamCloses = (phoneLifecycleState.streamCloses || 0) + 1; }
  constructor() {
    phoneLifecycleState.streamStarts = (phoneLifecycleState.streamStarts || 0) + 1;
    phoneLifecycleState.stream = this;
    queueMicrotask(() => this.onopen?.());
  }
}
(window as any).WebSocket = FixtureSocket;
(window as any).salesAppTest = {
  diagnostics: shellDiagnostics, state: phoneLifecycleState,
  tab(tab: string) { window.dispatchEvent(new CustomEvent('voicecap-android', { detail: JSON.stringify({ type: 'app-tab-change', tab, ok: true }) })); },
  comment(id = 'comment-1', nickname = '꽃미', content = '저 그거두') {
    phoneLifecycleState.stream?.onmessage?.({ data: JSON.stringify({
      messages: [{ type: 'WebcastChatMessage', data: { common: { msgId: id }, content, user: { userId: `user-${id}`, uniqueId: id, nickname } } }],
    }) });
  },
};
function Management() {
  const auth = useAuth();
  const { pathname } = useLocation();
  if (!auth.isAuthenticated) return <Navigate to="/login" replace />;
  return <section data-testid="management"><h1>{pathname}</h1>
    <Link to="/sales/sale-1?source=manage#detail">판매 상세</Link>
    <Link to="/settlement?period=current#totals">정산 이동</Link>
    <button onClick={() => void auth.logout()}>로그아웃</button>
  </section>;
}
function Entry() {
  const location = useLocation();
  return <><output data-testid="route">{location.pathname}{location.search}{location.hash}</output>
    <SalesAppShell><Routes>
      <Route path="/app/sell" element={null} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/sales/*" element={<Management />} />
      <Route path="/settlement" element={<Management />} />
    </Routes></SalesAppShell>
  </>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><FixtureAuthProvider><Entry /></FixtureAuthProvider></BrowserRouter>);
