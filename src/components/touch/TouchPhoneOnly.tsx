import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TouchSalesApi, TouchBootstrap } from '../../services/touchSalesApi';
import type { TouchComment, TouchSettings, TouchPrintTarget, TouchPrintRelayState } from '../../types/touchSales';
import {
  TouchPhoneProducer,
  blobToDataUrl,
  type PhoneCaptureRequest,
  type PhoneProducerStatus,
} from '../../services/touchPhoneProducer';
import {
  createPhonePrinter,
  realignBytes,
  saleLabelBytes,
  type PhoneLabelPrinter,
} from '../../services/labelPrinter/phonePrinter';
import { androidNative } from '../../services/labelPrinter/androidBridge';
import { marklifeCommands } from '../../services/labelPrinter/marklifeProtocol';
import { grabSharpestFrame, startFrontCamera } from '../../services/frontCamera';
import { productSalesApi } from '../../services/productSalesApi';
import { remoteWorkspaceService } from '../../services/remoteWorkspaceService';
import { TouchErrorNotice } from './TouchErrorNotice';
import { recordPhoneCaptureDiagnostic, type PhoneCaptureDiagnostic } from '../../services/phoneCaptureDiagnostics';

const producerKey = (workspaceId: string) => `voicecap-phone-producer:${workspaceId}`;
const learnedKey = (workspaceId: string) => `voicecap-phone-printer-learned:${workspaceId}`;
const targetKey = (workspaceId: string) => `voicecap-phone-print-target:${workspaceId}`;
const targetLabel = (target: TouchPrintTarget) => target === 'PC_HELPER' ? 'PC 판매도우미' : '폰 블루투스';
const printerReconnectError = '저장된 프린터에 연결하지 못했습니다. 프린터 전원을 확인한 뒤 다시 연결해 주세요.';
type ShotPhase = 'PREPARING' | 'COUNTDOWN' | 'SAMPLING' | 'ENCODING' | 'PREVIEW';
const read = (key: string) => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

const commentLabel = (s: PhoneProducerStatus['comments']) =>
  s.state === 'connected'
    ? '댓글 ● 받는 중'
    : s.state === 'waiting'
      ? `댓글 ● ${s.message}`
      : s.state === 'error'
        ? `댓글 ● ${s.message}`
        : s.state === 'stopped'
          ? '댓글 ● 멈춤'
          : '댓글 ● 연결 중';

export interface TouchPhoneOnlyProps {
  api: TouchSalesApi;
  bootstrap: TouchBootstrap | null;
  refresh: () => Promise<void>;
  serverOffset: () => number;
  totals: () => { totalCount: number; totalAmount: number };
  onComments: (comments: TouchComment[]) => void;
  onRunningChange: (running: boolean) => void;
  /** PC가 판매 화면과 연결되어 있으면 폰 판매를 권하지 않는다. */
  pcOnline?: boolean;
  /** 판매가 바뀔 때마다 바뀌는 값: 전표·사진을 바로 확인한다. */
  wakeKey: unknown;
  /** 가격 입력·판매 상세에서도 댓글·인쇄·촬영은 유지하고 조작 줄만 숨긴다. */
  controlsVisible?: boolean;
}

/** PC 없이 이 폰이 댓글·전표·사진을 맡는 판매. PC가 판매 중이면 아무것도 보이지 않는다. */
export function TouchPhoneOnly(props: TouchPhoneOnlyProps) {
  const { api, bootstrap } = props;
  const workspaceId = api.workspaceId;
  const printer = useRef<PhoneLabelPrinter>(createPhonePrinter());
  const producer = useRef<TouchPhoneProducer | null>(null);
  const producerId = useRef(read(producerKey(workspaceId)) || crypto.randomUUID());
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const mounted = useRef(true);
  const captureAttempt = useRef(0);
  const previewResources = useRef<{ timer?: ReturnType<typeof setTimeout>; url?: string }>({});
  const printerFlight = useRef<Promise<boolean> | null>(null);
  const manuallyDisconnected = useRef(false);
  const [, refreshPrinterState] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectingPrinter, setConnectingPrinter] = useState(false);
  const [printerNotice, setPrinterNotice] = useState('');
  const [printTarget, setPrintTarget] = useState<TouchPrintTarget>(() =>
    read(targetKey(workspaceId)) === 'PC_HELPER' ? 'PC_HELPER' : 'PHONE_BLUETOOTH');
  const targetRef = useRef(printTarget);
  targetRef.current = printTarget;
  const [relay, setRelay] = useState<TouchPrintRelayState | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<TouchPrintTarget>(printTarget);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<TouchSettings | null>(null);
  const [tiktokId, setTiktokId] = useState('');
  const [status, setStatus] = useState<PhoneProducerStatus | null>(null);
  const [printerName, setPrinterName] = useState('');
  const [shot, setShot] = useState<{ dueAt: number; phase: ShotPhase; since: number; preview?: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const running = !!status && !!producer.current?.running;
  const relayReady = !!relay?.ready && Date.parse(relay.leaseExpiresAt) > Date.now() + props.serverOffset();

  useEffect(() => {
    if (!running) setPrintTarget(read(targetKey(workspaceId)) === 'PC_HELPER' ? 'PC_HELPER' : 'PHONE_BLUETOOTH');
  }, [workspaceId]);

  useEffect(() => {
    if (!running || busy || bootstrap?.run?.producer_id !== producerId.current) return;
    const canonical = bootstrap.run.settings.printTarget === 'PC_HELPER' ? 'PC_HELPER' : 'PHONE_BLUETOOTH';
    setPrintTarget(canonical);
    producer.current?.syncPrintTarget(canonical);
    write(targetKey(workspaceId), canonical);
  }, [bootstrap, running, busy, workspaceId]);

  useEffect(() => {
    if (!open && !running && !outputOpen) return;
    let active = true, checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const result = await api.printRelayStatus();
        if (active) setRelay(result.printRelay);
      } catch {
        if (active) setRelay(null);
      } finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    window.addEventListener('focus', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [api, open, running, outputOpen]);

  const run = bootstrap?.run;
  const serverNow = Date.now() + props.serverOffset();
  const runAlive = !!run?.running && Date.parse(run.lease_expires_at) > serverNow;
  const mineStale =
    !running && !!run?.running && run.producer_id === producerId.current && run.last_state?.phoneOnly === true;
  const pcSelling =
    (!!props.pcOnline && run?.last_state?.phoneOnly !== true) ||
    (runAlive && run!.producer_id !== producerId.current);

  useEffect(() => {
    let active = true;
    void remoteWorkspaceService
      .fetchWorkspaceSettings<TouchSettings>(workspaceId, 'touch_sales')
      .then((value) => {
        if (!active) return;
        const merged: TouchSettings = {
          mode: 'COMMENT_TOUCH',
          prepareSeconds: 4,
          fallbackDelaySeconds: 0,
          ...(value || {}),
        };
        setSettings(merged);
        setTiktokId(merged.tiktokId || '');
      })
      .catch(() => active && setSettings({ mode: 'COMMENT_TOUCH', prepareSeconds: 4, fallbackDelaySeconds: 0 }));
    return () => {
      active = false;
    };
  }, [workspaceId, open]);

  useEffect(() => {
    producer.current?.wake();
  }, [props.wakeKey]);

  useEffect(() => {
    if (!shot) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [shot]);

  const releasePreview = useCallback(() => {
    if (previewResources.current.timer) clearTimeout(previewResources.current.timer);
    if (previewResources.current.url) URL.revokeObjectURL(previewResources.current.url);
    previewResources.current = {};
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      captureAttempt.current++;
      releasePreview();
      void producer.current?.stop();
      androidNative()?.selling(false);
    };
  }, [releasePreview]);

  const capture = useCallback(async (request: PhoneCaptureRequest) => {
    const attempt = ++captureAttempt.current;
    const active = () => mounted.current && captureAttempt.current === attempt;
    releasePreview();
    setNow(Date.now());
    setShot({ dueAt: request.dueAt, phase: 'PREPARING', since: Date.now() });
    const started = performance.now();
    const diagnostic: PhoneCaptureDiagnostic = {
      saleId: request.saleId,
      generation: request.generation,
      startedAt: new Date().toISOString(),
      status: 'FAILED',
      timings: { cameraMs: 0, countdownMs: 0, samplingMs: 0, encodingMs: 0, serializationMs: 0, totalMs: 0 },
    };
    let stage: keyof PhoneCaptureDiagnostic['timings'] = 'cameraMs';
    let stageStarted = started;
    const finishStage = () => {
      const time = performance.now();
      diagnostic.timings[stage] += Math.round(time - stageStarted);
      stageStarted = time;
    };
    const phase = (next: ShotPhase, nextStage: keyof PhoneCaptureDiagnostic['timings']) => {
      finishStage();
      stage = nextStage;
      if (active()) setShot({ dueAt: request.dueAt, phase: next, since: Date.now() });
    };
    let stream: MediaStream | null = null;
    try {
      const el = video.current;
      if (!el) throw new Error('카메라 화면을 열지 못했습니다.');
      stream = await startFrontCamera(el, 1280);
      if (!active()) return null;
      phase('COUNTDOWN', 'countdownMs');
      const wait = request.dueAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!active()) return null;
      const frame = await grabSharpestFrame(el, {
        count: 3, gapMs: 150,
        onPhase: (next) => phase(next, next === 'SAMPLING' ? 'samplingMs' : 'encodingMs'),
      });
      finishStage();
      if (!active()) {
        URL.revokeObjectURL(frame.url);
        return null;
      }
      setShot({ dueAt: request.dueAt, phase: 'PREVIEW', since: Date.now(), preview: frame.url });
      previewResources.current = { url: frame.url, timer: setTimeout(() => {
        if (active()) setShot((value) => (value?.preview === frame.url ? null : value));
        if (previewResources.current.url === frame.url) releasePreview();
      }, 1200) };
      stage = 'serializationMs';
      const data = await blobToDataUrl(frame.blob);
      diagnostic.status = active() ? 'CAPTURED' : 'CANCELLED';
      return data;
    } catch (e) {
      if (active()) {
        setError(`사진을 찍지 못했습니다: ${(e as Error).message}`);
        setShot(null);
        releasePreview();
      }
      return null;
    } finally {
      finishStage();
      if (!active()) diagnostic.status = 'CANCELLED';
      diagnostic.timings.totalMs = Math.round(performance.now() - started);
      recordPhoneCaptureDiagnostic(workspaceId, diagnostic);
      stream?.getTracks().forEach((t) => t.stop());
    }
  }, [releasePreview, workspaceId]);

  const connectPrinter = useCallback((pick: boolean, automatic = false): Promise<boolean> => {
    if (printerFlight.current) return printerFlight.current;
    if (automatic && targetRef.current !== 'PHONE_BLUETOOTH') return Promise.resolve(false);
    if (automatic && manuallyDisconnected.current) return Promise.resolve(false);
    const p = printer.current;
    if (automatic && (p.connected || !p.saved)) return Promise.resolve(p.connected);
    if (!automatic) setError('');
    setConnectingPrinter(true);
    printerFlight.current = (async () => {
      try {
        if (pick || manuallyDisconnected.current) await p.connect();
        else if (!p.connected && !(await p.reconnect())) {
          if (automatic) throw new Error(printerReconnectError);
          await p.connect();
        }
        if (!mounted.current) return p.connected;
        // 연결 알림: M50은 이 명령 뒤에 보내도 되는 양(허용 신호)을 알려 준다.
        await p.send(marklifeCommands.btType());
        // 처음 연결한 폰은 라벨 길이를 한 번 잰다.
        if (!read(learnedKey(workspaceId))) {
          await p.send(realignBytes());
          write(learnedKey(workspaceId), String(Date.now()));
        }
        if (mounted.current) {
          // Only an explicit successful connection resumes auto-reconnect after "끊기".
          manuallyDisconnected.current = false;
          setPrinterNotice('');
          setPrinterName(p.name);
          setError((current) => current === printerReconnectError ? '' : current);
          producer.current?.wake();
        }
        return true;
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
        return false;
      } finally {
        printerFlight.current = null;
        if (mounted.current) setConnectingPrinter(false);
      }
    })();
    return printerFlight.current;
  }, [workspaceId]);

  const disconnectPrinter = () => {
    if (busy || connectingPrinter || printerFlight.current) return;
    // Keep the native saved device, but honor this choice until another printer is selected.
    manuallyDisconnected.current = true;
    printer.current.disconnect();
    setPrinterName('');
    setPrinterNotice('');
    setError('');
    refreshPrinterState((value) => value + 1);
    producer.current?.wake();
  };

  useEffect(() => {
    const reconnect = () => {
      if (document.visibilityState === 'visible') void connectPrinter(false, true);
    };
    reconnect();
    document.addEventListener('visibilitychange', reconnect);
    window.addEventListener('focus', reconnect);
    return () => {
      document.removeEventListener('visibilitychange', reconnect);
      window.removeEventListener('focus', reconnect);
    };
  }, [connectPrinter, open]);

  const realign = async () => {
    if (busy || connectingPrinter || printerFlight.current || !printer.current.connected || status?.printer.printing) return;
    setBusy(true);
    setError('');
    setPrinterNotice('');
    try {
      await printer.current.send(realignBytes());
      write(learnedKey(workspaceId), String(Date.now()));
      setPrinterNotice('라벨 맞춤 요청을 보냈습니다. 용지가 멈춘 뒤 출력해 주세요.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async (choice: 'NEW' | 'CONTINUE') => {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      const id = tiktokId.trim().replace(/^@/, '');
      if (!id) throw new Error('틱톡 ID를 입력해 주세요.');
      // 앱에 기억된 프린터만 다시 연결한다. 자동 연결은 기기 선택 창을 열지 않는다.
      if (printTarget === 'PC_HELPER') {
        if (!relayReady) throw new Error('PC에서 판매도우미를 켜고 댓글터치 판매 화면의 폰 전표 출력 대기를 시작해 주세요.');
      } else await connectPrinter(false, true);
      if (!mounted.current) return;
      if (id !== (settings.tiktokId || '')) await api.call('touch-tiktok-id', { uniqueId: id });
      let session = choice === 'CONTINUE' ? bootstrap?.session : null;
      if (!session) {
        const started = await productSalesApi.startSession(crypto.randomUUID());
        const s = started.session as unknown as { id: string; displayCode?: string; display_code?: string };
        session = { id: s.id, display_code: s.displayCode || s.display_code || '', status: 'ACTIVE' };
      }
      write(producerKey(workspaceId), producerId.current);
      const p = new TouchPhoneProducer({
        api,
        producerId: producerId.current,
        sessionId: session.id,
        displayCode: session.display_code,
        settings: { ...settings, mode: 'COMMENT_TOUCH', tiktokId: id, printTarget },
        printer: printer.current,
        serverOffset: props.serverOffset,
        totals: props.totals,
        label: (content) => saleLabelBytes(content, canvas.current || undefined),
        capture,
        onComments: props.onComments,
        onStatus: (s) => setStatus(s),
        onError: (kind, e) => {
          if (kind === 'LEASE_LOST') {
            captureAttempt.current++;
            releasePreview();
            setShot(null);
            setError('다른 기기로 판매 연결이 바뀌어 이 폰의 판매를 멈췄습니다.');
            setStatus(null);
            props.onRunningChange(false);
            androidNative()?.selling(false);
          } else if (kind === 'PRINT_ERROR') setError(`전표 인쇄 실패: ${(e as Error)?.message || ''}`);
        },
        onChange: () => void props.refresh(),
      });
      await p.start();
      write(targetKey(workspaceId), printTarget);
      producer.current = p;
      props.onRunningChange(true);
      androidNative()?.selling(true);
      setOpen(false);
      await props.refresh();
    } catch (e) {
      const code = (e as any)?.code;
      setError(
        code === 'PC_ALREADY_RUNNING'
          ? '다른 기기에서 판매 중입니다. 해당 기기의 판매를 멈춘 뒤 다시 시도해 주세요.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    captureAttempt.current++;
    releasePreview();
    setShot(null);
    setOutputOpen(false);
    setBusy(true);
    try {
      await producer.current?.stop();
      producer.current = null;
      setStatus(null);
      props.onRunningChange(false);
      androidNative()?.selling(false);
      await props.refresh();
    } finally {
      setBusy(false);
    }
  };

  const applyPrintTarget = async () => {
    if (busy || !producer.current?.running) return;
    if (pendingTarget === 'PC_HELPER' && !relayReady) {
      setError('PC 판매도우미의 전표 출력 대기를 먼저 시작해 주세요.');
      return;
    }
    if (pendingTarget === 'PHONE_BLUETOOTH' && !printer.current.connected) {
      setError('폰 블루투스 프린터를 먼저 연결해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const target = await producer.current.changePrintTarget(pendingTarget);
      setPrintTarget(target);
      targetRef.current = target;
      write(targetKey(workspaceId), target);
      setPrinterNotice(`출력 위치를 ${targetLabel(target)}로 변경했습니다. 대기 전표부터 적용됩니다.`);
      setOutputOpen(false);
      await props.refresh();
    } catch (e) {
      setError((e as Error).message || '출력 위치를 변경하지 못했습니다.');
    } finally { setBusy(false); }
  };

  const renderPrintTargets = (value: TouchPrintTarget, change: (value: TouchPrintTarget) => void) => (
    <fieldset className="touch-print-target" disabled={busy}>
      <legend>전표 출력 위치</legend>
      <label><input type="radio" name="phone-print-target" value="PHONE_BLUETOOTH" checked={value === 'PHONE_BLUETOOTH'}
        onChange={() => change('PHONE_BLUETOOTH')} />폰 블루투스</label>
      <label><input type="radio" name="phone-print-target" value="PC_HELPER" checked={value === 'PC_HELPER'}
        onChange={() => change('PC_HELPER')} />PC 판매도우미</label>
      {value === 'PC_HELPER' && <p role="status">
        {relayReady ? `PC 전표 대기 연결됨${relay?.printerName ? ` · ${relay.printerName}` : ''}`
          : 'PC에서 판매도우미를 켜고 댓글터치 판매 화면의 ‘폰 전표 출력 대기’를 시작해 주세요.'}
      </p>}
      <small>댓글 수신과 사진 촬영은 이 폰에서 계속합니다.</small>
    </fieldset>
  );

  const overlay = (
    <>
      <canvas ref={canvas} hidden />
      <div className={shot ? 'touch-phone-shot' : 'touch-phone-shot touch-phone-shot-idle'} aria-hidden={!shot}>
        <video ref={video} playsInline muted />
        {shot && !shot.preview && (
          <strong className={(shot.phase === 'SAMPLING' && now - shot.since < 400) || (shot.phase === 'COUNTDOWN' && shot.dueAt > now) ? '' : 'touch-phone-shot-message'}>
            {shot.phase === 'PREPARING' ? '카메라 준비 중'
              : shot.phase === 'SAMPLING' ? (now - shot.since < 400 ? '찰칵' : '사진 처리 중')
                : shot.phase === 'ENCODING' ? '사진 처리 중'
                  : Math.max(0, Math.ceil((shot.dueAt - now) / 1000)) || '촬영 준비 중'}
          </strong>
        )}
        {shot?.preview && <img src={shot.preview} alt="방금 찍은 판매 사진" />}
      </div>
    </>
  );

  // 화면 전환 때문에 생산자를 해제하면 서버 판매 연결도 STOP된다.
  // 보조 화면에서는 카메라와 생산자를 유지한 채 조작 UI만 감춘다.
  if (props.controlsVisible === false) return <>{overlay}</>;

  if (pcSelling && !running)
    return (
      <>
        {overlay}
        {androidNative() && (
          <p className="touch-waiting">
            다른 기기에서 판매 중입니다. 해당 기기의 판매를 멈춘 뒤 시작해 주세요.
          </p>
        )}
      </>
    );

  if (running && status)
    return (
      <>
        {overlay}
        <div className="touch-phone-bar" role="status">
          <span className={status.comments.state === 'connected' ? 'ok' : 'warn'}>
            {commentLabel(status.comments)}
          </span>
          <span className={(printTarget === 'PC_HELPER' ? relayReady : status.printer.connected) ? 'ok' : 'warn'}>
            {printTarget === 'PC_HELPER'
              ? `PC 판매도우미 ● ${relayReady ? '연결됨' : '연결 대기'}${relay?.printerName && relayReady ? ` · ${relay.printerName}` : ''}`
              : `폰 블루투스 ● ${connectingPrinter ? '연결 중' : status.printer.connected ? `연결됨${status.printer.name || printerName ? ` · ${status.printer.name || printerName}` : ''}` : '끊김'}`}
            {printTarget !== 'PC_HELPER' && status.printer.printing ? ' · 인쇄 중' : ''}
          </span>
          {printTarget === 'PHONE_BLUETOOTH' && (!status.printer.connected ? (
            <button disabled={connectingPrinter} onClick={() => void connectPrinter(false)}>
              프린터 연결
            </button>
          ) : (
            <button disabled={busy || connectingPrinter || status.printer.printing} onClick={() => void realign()}>
              라벨 다시 맞추기
            </button>
          ))}
          <button disabled={busy} onClick={() => { setPendingTarget(printTarget); setError(''); setOutputOpen(true); }}>
            출력 위치 변경
          </button>
          <button className="touch-phone-stop" disabled={busy} onClick={() => void stop()}>
            판매 멈춤
          </button>
        </div>
        {printerNotice && <p role="status" className="touch-muted touch-printer-notice">{printerNotice}</p>}
        <TouchErrorNotice message={error} onDismiss={() => setError('')} className="touch-page-error" />
        {outputOpen && (
          <div className="touch-modal-backdrop" role="dialog" aria-modal="true" aria-label="출력 위치 변경">
            <section className="touch-modal">
              <h2>출력 위치 변경</h2>
              {renderPrintTargets(pendingTarget, setPendingTarget)}
              <p className="touch-muted">출력 중인 전표가 있으면 완료 후 변경할 수 있습니다. 아직 출력하지 않은 대기 전표부터 새 위치로 보냅니다. 출력 여부 확인이 필요한 전표는 자동으로 다시 보내지 않습니다.</p>
              {pendingTarget === 'PHONE_BLUETOOTH' && <div className="touch-phone-printer">
                <span>{printer.current.connected ? `연결됨 · ${printer.current.name}` : '폰 프린터 연결 안 됨'}</span>
                <button disabled={busy || connectingPrinter} onClick={() => void connectPrinter(true)}>
                  {printer.current.connected ? '다른 프린터' : '프린터 연결'}
                </button>
              </div>}
              <TouchErrorNotice message={error} onDismiss={() => setError('')} />
              <button className="touch-primary" disabled={busy || connectingPrinter || pendingTarget === printTarget ||
                (pendingTarget === 'PC_HELPER' ? !relayReady : !printer.current.connected)} onClick={() => void applyPrintTarget()}>
                대기 전표부터 적용
              </button>
              <button disabled={busy} onClick={() => { setOutputOpen(false); setError(''); }}>닫기</button>
            </section>
          </div>
        )}
      </>
    );

  return (
    <>
      {overlay}
      <div className="touch-phone-offer">
        <span>{mineStale ? '이 폰의 판매가 멈춰 있습니다.' : '이 폰에서 라이브 판매를 진행할 수 있습니다.'}</span>
        <button className="touch-primary" onClick={() => setOpen(true)}>
          {mineStale ? '이 폰으로 이어서 판매' : '폰으로 판매 시작'}
        </button>
      </div>
      {!open && <TouchErrorNotice message={error} onDismiss={() => setError('')} className="touch-page-error" />}
      {open && (
        <div className="touch-modal-backdrop" role="dialog" aria-label="폰으로 판매 시작">
          <section className="touch-modal touch-phone-start">
            <h2>폰으로 판매 시작</h2>
            <label>
              틱톡 ID (@ 제외)
              <input
                value={tiktokId}
                onChange={(e) => setTiktokId(e.target.value)}
                placeholder="예: voicecap_live"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <p className="touch-muted">
              댓글은 이 폰이 직접 받습니다. 전표는 선택한 출력 위치로 보내고, 판매 사진은{' '}
              {settings?.captureOff
                ? '찍지 않습니다(캡처 안 함).'
                : `${settings?.prepareSeconds ?? 4}초 카운트다운 뒤 앞카메라로 1장 찍습니다.`}
            </p>
            {renderPrintTargets(printTarget, setPrintTarget)}
            {printTarget === 'PHONE_BLUETOOTH' && <div className="touch-phone-printer">
              <span>
                프린터 ● {connectingPrinter ? '연결 중' : printer.current.connected ? `연결됨${printer.current.name || printerName ? ` · ${printer.current.name || printerName}` : ''}` : '연결 안 됨'}
              </span>
              {printer.current.connected && (
                <button
                  type="button"
                  className="touch-printer-disconnect"
                  disabled={busy || connectingPrinter}
                  onClick={disconnectPrinter}
                >
                  끊기
                </button>
              )}
              <button
                type="button"
                disabled={busy || connectingPrinter}
                onClick={() => void connectPrinter(true)}
              >
                {printer.current.connected ? '다른 프린터' : '프린터 연결'}
              </button>
              <button
                type="button"
                disabled={busy || connectingPrinter || !printer.current.connected}
                onClick={() => void realign()}
              >
                라벨 다시 맞추기
              </button>
            </div>}
            {printerNotice && <p role="status" className="touch-muted">{printerNotice}</p>}
            <TouchErrorNotice message={error} onDismiss={() => setError('')} />
            {bootstrap?.session && (
              <button className="touch-primary" disabled={busy || connectingPrinter || !settings || (printTarget === 'PC_HELPER' && !relayReady)} onClick={() => void start('CONTINUE')}>
                지금 회차 이어서 판매
              </button>
            )}
            <button
              className={bootstrap?.session ? '' : 'touch-primary'}
              disabled={busy || connectingPrinter || !settings || (printTarget === 'PC_HELPER' && !relayReady)}
              onClick={() => {
                if (bootstrap?.session && !confirm('지금 회차를 끝내고 새 회차로 판매할까요?')) return;
                void start('NEW');
              }}
            >
              새 회차로 판매 시작
            </button>
            <button disabled={busy} onClick={() => setOpen(false)}>
              닫기
            </button>
          </section>
        </div>
      )}
    </>
  );
}
