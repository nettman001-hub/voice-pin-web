import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  useRuntimeAuth,
  useWorkspaceRuntime,
} from '../../context/WorkspaceRuntimeContext';
import { useTouchMode } from '../../context/TouchModeContext';
import { useCommentCapture } from '../../context/CommentCaptureContext';
import { useSales } from '../../context/SalesContext';
import { useProductSales } from '../../context/ProductSalesContext';
import { useCustomerStatsIndex } from '../../context/CustomerStatsContext';
import { TouchSalesApi } from '../../services/touchSalesApi';
import { TouchSalesBridge } from '../../services/touchSalesBridge';
import {
  TouchFrameBuffer,
  type TouchFrame,
} from '../../services/touchFrameBuffer';
import { TouchPcWorker } from '../../services/touchPcWorker';
import {
  AudioEnvelopeSampler,
  estimateTouchDelay,
  StableTouchDelay,
  type EnvelopeSample,
} from '../../services/touchDelayEstimator';
import { screenCaptureService } from '../../services/screenCaptureService';
import { customerStatsLabel } from '../../services/customerStatsIndex';
import type {
  TouchPcState,
  TouchSale,
  TouchSalesMode,
  TouchTransport,
} from '../../types/touchSales';
import { isCountedSale } from '../../services/saleRowHistory';
import { productSalesApi } from '../../services/productSalesApi';
import { TouchTelemetry } from '../../services/touchTelemetry';
import { measureTouchClock } from '../../services/touchClock';
import { TOUCH_SALES_MODES } from '../../services/touchSaleModes';

export const TouchDesktopPanel: React.FC = () => {
  const { workspaceId, isRemoteAuth } = useRuntimeAuth();
  const runtime = useWorkspaceRuntime();
  const { settings, save, runningSession, setRunningSession } = useTouchMode();
  const comments = useCommentCapture();
  const { sales, refreshSales } = useSales();
  const { activeSession, activeProduct, loadBootstrap, startNewSession } =
    useProductSales();
  const stats = useCustomerStatsIndex();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [qr, setQr] = useState(''),
    [showQr, setShowQr] = useState(false);
  const [transport, setTransport] = useState<TouchTransport>('DISCONNECTED'),
    [phoneCount, setPhoneCount] = useState(0);
  const [screenConnected, setScreenConnected] = useState(
    screenCaptureService.getConnectionState().isConnected,
  );
  const [delay, setDelay] = useState<{
    seconds: number;
    source: 'AUTO' | 'LAST' | 'SETTING';
  }>({ seconds: settings.fallbackDelaySeconds, source: 'SETTING' });
  const [records, setRecords] = useState<TouchSale[]>([]),
    [candidates, setCandidates] = useState<{
      saleId: string;
      frames: TouchFrame[];
    } | null>(null);
  const api = useMemo(
    () => (workspaceId ? new TouchSalesApi(workspaceId) : null),
    [workspaceId],
  );
  const telemetry = useMemo(
    () => (api ? new TouchTelemetry(api) : null),
    [api],
  );
  const lastTick = useRef(Date.now()),
    previousHelper = useRef(comments.serverStatus);
  const producer = useRef(crypto.randomUUID());
  const bridge = useRef<TouchSalesBridge | null>(null),
    worker = useRef<TouchPcWorker | null>(null),
    frames = useRef(new TouchFrameBuffer());
  const sampler = useRef(new AudioEnvelopeSampler()),
    phoneSamples = useRef<EnvelopeSample[]>([]),
    tabSamples = useRef<EnvelopeSample[]>([]);
  const stableDelay = useRef(new StableTouchDelay()),
    lastMeasure = useRef(0),
    lastGoodDelay = useRef(0),
    serverOffset = useRef(0);
  const [tick, setTick] = useState(0);
  const metrics = useRef<Record<string, number>>({});
  const lifecycle = useRef(0);
  const live = useRef({
    settings,
    delay,
    comments,
    activeSession,
    activeProduct,
    sales,
    stats,
    runningSession,
    transport,
    phoneCount,
  });
  live.current = {
    settings,
    delay,
    comments,
    activeSession,
    activeProduct,
    sales,
    stats,
    runningSession,
    transport,
    phoneCount,
  };
  const url = typeof window !== 'undefined' ? `${location.origin}/sell` : '';
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(url, { width: 260, margin: 2 }).then((data) => {
      if (active) setQr(data);
    });
    return () => {
      active = false;
    };
  }, [url]);
  useEffect(
    () =>
      screenCaptureService.subscribeConnection((state) =>
        setScreenConnected(state.isConnected),
      ),
    [],
  );
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let mounted = true;
    if (settings.fallbackDelaySeconds === 0) {
      setDelay({ seconds: 0, source: 'SETTING' });
      return;
    }
    if (workspaceId)
      try {
        const last = Number(
          localStorage.getItem(`voicecap-touch-delay:${workspaceId}`),
        );
        if (Number.isFinite(last) && last >= 1 && last <= 20)
          setDelay({ seconds: last, source: 'LAST' });
      } catch {}
    return () => {
      mounted = false;
    };
  }, [workspaceId, settings.fallbackDelaySeconds]);
  const refresh = async () => {
    if (!api) return;
    const generation = lifecycle.current,
      started = Date.now();
    const result = await api.bootstrap();
    if (generation !== lifecycle.current) return;
    setRecords(result.sales);
    void refreshSales();
  };
  const report = (kind: string, _e?: unknown) => {
    if (
      ['PRINT_ERROR', 'CAPTURE_MISSING', 'HELPER_ERROR', 'LATE_SALE'].includes(
        kind,
      ) &&
      api &&
      live.current.activeSession
    )
      telemetry?.log(kind, live.current.activeSession.id, producer.current);
    if (kind === 'WORKER_ERROR' && (_e as any)?.code === 'PC_LEASE_LOST') {
      setError(
        '다른 PC로 판매 연결이 바뀌었습니다. 이 화면의 처리를 멈췄습니다.',
      );
      cleanup();
    }
  };
  const pcState = (sessionId: string, displayCode: string): TouchPcState => {
    const current = live.current,
      rows = current.sales.filter(
        (s) => s.sessionId === sessionId && isCountedSale(s),
      );
    return {
      running: !!current.runningSession,
      producerId: producer.current,
      sessionId,
      displayCode,
      helperConnected: runtime.commentStreamService.isConnectedToServer,
      commentStatus: current.comments.serverStatus,
      screenConnected: screenCaptureService.getConnectionState().isConnected,
      printerConnected: runtime.commentStreamService.isConnectedToServer,
      delaySeconds: current.delay.seconds,
      delaySource: current.delay.source,
      prepareSeconds: current.settings.prepareSeconds,
      product: current.activeProduct,
      totalCount: rows.length,
      totalAmount: rows.reduce((sum, s) => sum + s.amount, 0),
      transport: current.transport,
      phoneCount: current.phoneCount,
    };
  };
  const cleanup = () => {
    ++lifecycle.current;
    worker.current?.stop();
    worker.current = null;
    bridge.current?.stop();
    bridge.current = null;
    frames.current.stop();
    sampler.current.stop();
    phoneSamples.current = [];
    tabSamples.current = [];
    setRunningSession(null);
    void live.current.comments.stopCapture();
  };
  useEffect(() => () => cleanup(), [workspaceId]);
  useEffect(() => {
    if (!api || !runningSession) return;
    const session = live.current.activeSession;
    if (!session || session.id !== runningSession) return;
    const heartbeat = async () => {
      const state = pcState(session.id, session.displayCode);
      bridge.current?.setPcState(state);
      try {
        await api.run(
          'HEARTBEAT',
          producer.current,
          session.id,
          live.current.settings,
          state,
        );
      } catch (e) {
        if ((e as any)?.code === 'PC_LEASE_LOST') {
          report('WORKER_ERROR', e);
        } else
          setError(
            'PC 상태 전송이 지연되고 있습니다. 인터넷 연결을 확인해 주세요.',
          );
      }
    };
    void heartbeat();
    const timer = setInterval(() => void heartbeat(), 10000);
    const summary = setInterval(() => {
      const values = metrics.current;
      metrics.current = {};
      telemetry?.log('SUMMARY', session.id, producer.current, values);
    }, 300000);
    return () => {
      clearInterval(timer);
      clearInterval(summary);
    };
  }, [api, runningSession]);
  useEffect(() => {
    const now = Date.now(),
      elapsed = Math.min(60, Math.max(0, (now - lastTick.current) / 1000));
    lastTick.current = now;
    if (!runningSession) return;
    const field =
      transport === 'DIRECT'
        ? 'directSeconds'
        : transport === 'FALLBACK'
          ? 'fallbackSeconds'
          : null;
    if (field) metrics.current[field] = (metrics.current[field] || 0) + elapsed;
    if (delay.source === 'AUTO') {
      metrics.current.delaySum =
        (metrics.current.delaySum || 0) + delay.seconds * elapsed;
      metrics.current.delaySamples =
        (metrics.current.delaySamples || 0) + elapsed;
      metrics.current.delayMaximum = Math.max(
        metrics.current.delayMaximum || 0,
        delay.seconds,
      );
    } else
      metrics.current.delayUnavailableSeconds =
        (metrics.current.delayUnavailableSeconds || 0) + elapsed;
    if (
      previousHelper.current !== comments.serverStatus &&
      ['DISCONNECTED', 'ERROR'].includes(comments.serverStatus) &&
      activeSession
    )
      telemetry?.log('HELPER_ERROR', activeSession.id, producer.current);
    previousHelper.current = comments.serverStatus;
  }, [tick, runningSession, transport, delay, comments.serverStatus]);
  useEffect(() => {
    if (!runningSession || !activeSession) return;
    bridge.current?.setPcState(
      pcState(activeSession.id, activeSession.displayCode),
    );
    bridge.current?.publish(
      comments.liveComments
        .filter((c) => c.sessionId === runningSession)
        .map((c) => {
          const s = stats?.lookup(c);
          const { validSales: _rows, ...numbers } = s || { validSales: [] };
          return { ...c, sequence: 0, stats: s ? (numbers as any) : undefined };
        }),
    );
  }, [
    runningSession,
    comments.liveComments,
    comments.serverStatus,
    stats,
    sales,
    delay,
    screenConnected,
    activeProduct,
    tick,
  ]);
  useEffect(() => {
    worker.current?.wake();
  }, [sales]);
  useEffect(() => {
    if (!runningSession || settings.fallbackDelaySeconds === 0) return;
    const now = Date.now();
    if (now - lastMeasure.current < 10000) return;
    lastMeasure.current = now;
    const estimate = estimateTouchDelay(
      phoneSamples.current,
      tabSamples.current,
      now,
    );
    const seconds = stableDelay.current.add(estimate);
    if (seconds !== null) {
      lastGoodDelay.current = now;
      setDelay({ seconds, source: 'AUTO' });
      try {
        localStorage.setItem(
          `voicecap-touch-delay:${workspaceId}`,
          String(seconds),
        );
      } catch {}
    } else if (now - lastGoodDelay.current > 20000)
      setDelay((current) => ({
        ...current,
        source: current.source === 'SETTING' ? 'SETTING' : 'LAST',
      }));
  }, [tick, runningSession]);
  const start = async (choice: 'NEW' | 'CONTINUE') => {
    if (!api || !isRemoteAuth) {
      setError('실제 판매자 계정으로 로그인한 뒤 사용해 주세요.');
      return;
    }
    if (!comments.config.tiktokUsername) {
      setError('댓글 도우미 설정에서 틱톡 ID를 저장해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    const generation = ++lifecycle.current;
    // Open the browser picker within the button gesture; microphone/STT are never started.
    // 캡처 안 함이면 화면 공유 없이 판매를 시작한다.
    const captureOff = settings.captureOff === true;
    const streamPromise = captureOff
      ? Promise.resolve(null)
      : screenCaptureService.getOrCreateStream();
    try {
      const sessionPromise =
        choice === 'NEW'
          ? startNewSession()
          : loadBootstrap().then((b) => {
              if (!b?.activeSession)
                throw new Error(
                  '이어갈 회차가 없습니다. 새 회차로 시작해 주세요.',
                );
              return b.activeSession;
            });
      const [stream, session] = await Promise.all([
        streamPromise,
        sessionPromise,
      ]);
      if (generation !== lifecycle.current) return;
      if (!stream && !captureOff)
        throw new Error('틱톡 라이브 화면 공유를 선택해 주세요.');
      await api.run('START', producer.current, session.id, settings, {
        ...pcState(session.id, session.displayCode),
        running: true,
      });
      if (generation !== lifecycle.current) return;
      const began = Date.now(),
        bootstrap = await api.bootstrap();
      serverOffset.current = bootstrap.serverNow - (began + Date.now()) / 2;
      setRecords(bootstrap.sales);
      const measured = await measureTouchClock(() => api.clock()).catch(
        () => null,
      );
      if (measured) serverOffset.current = measured.offset;
      setRunningSession(session.id);
      comments.startCapture();
      if (stream) frames.current.start(
        () =>
          runtime.storageService.getCaptureAreaConfig() || {
            preset: 'FULL_SCREEN',
            name: '방송 화면',
            xRatio: 0,
            yRatio: 0,
            widthRatio: 1,
            heightRatio: 1,
          },
      );
      if (stream) void sampler.current
        .start(stream, (sample) => {
          tabSamples.current.push(sample);
          tabSamples.current = tabSamples.current.filter(
            (s) => s.at > Date.now() - 60000,
          );
        })
        .catch(() => {});
      const pipe = new TouchSalesBridge({
        workspaceId: api.workspaceId,
        role: 'PC',
        id: producer.current,
        onStatus: (status, count) => {
          setTransport(status);
          setPhoneCount(count);
          metrics.current.transitions = (metrics.current.transitions || 0) + 1;
          if (
            status === 'DIRECT' ||
            status === 'FALLBACK' ||
            status === 'DISCONNECTED'
          )
            telemetry?.log(status, session.id, producer.current, {
              phoneCount: count,
            });
        },
        onMetric: (key, count) => {
          metrics.current[key] = (metrics.current[key] || 0) + count;
        },
        onPacket: (packet) => {
          if (
            packet.kind === 'audio' &&
            Array.isArray(packet.samples) &&
            pipe.transport === 'DIRECT'
          ) {
            for (const sample of packet.samples.slice(0, 30))
              if (
                Number.isFinite(sample.at) &&
                Number.isFinite(sample.value) &&
                Math.abs(Date.now() - sample.at) < 60000
              )
                phoneSamples.current.push({
                  at: sample.at,
                  value: Math.max(0, Math.min(1, sample.value)),
                });
            phoneSamples.current = phoneSamples.current.filter(
              (s) => s.at > Date.now() - 60000,
            );
          }
          if (
            packet.kind === 'search-comments' &&
            typeof packet.query === 'string' &&
            packet.query.length <= 100
          ) {
            const query = packet.query.toLocaleLowerCase();
            const found = runtime.storageService
              .getSessionCommentRecords(session.id, api.workspaceId)
              .filter(
                (c) =>
                  c.nickname.toLocaleLowerCase().includes(query) ||
                  (c.uniqueId || '').toLocaleLowerCase().includes(query),
              )
              .slice(-500)
              .map((c, i) => {
                const s = live.current.stats?.lookup(c);
                const { validSales: _rows, ...numbers } = s || {
                  validSales: [],
                };
                return {
                  ...c,
                  sequence: i - 500,
                  stats: s ? numbers : undefined,
                };
              });
            if (!found.length)
              pipe.send({
                kind: 'search-results',
                query: packet.query,
                items: [],
                reset: true,
                sessionId: session.id,
              });
            for (let i = 0; i < found.length; i += 20)
              pipe.send({
                kind: 'search-results',
                query: packet.query,
                items: found.slice(i, i + 20),
                reset: i === 0,
                sessionId: session.id,
              });
          }
          if (packet.kind === 'get-candidates') {
            if (pipe.transport !== 'DIRECT') {
              pipe.send({
                kind: 'notice',
                message: '예비 연결 중에는 PC에서 다른 장면을 선택해 주세요.',
              });
              return;
            }
            void worker.current
              ?.getCandidates(packet.saleId)
              .then((items) =>
                pipe.send({
                  kind: 'candidates',
                  saleId: packet.saleId,
                  frames: items,
                }),
              );
          }
          if (packet.kind === 'choose-frame' && pipe.transport === 'DIRECT')
            void worker.current
              ?.chooseFrame(packet.saleId, packet.index)
              .then(() =>
                pipe.send({
                  kind: 'notice',
                  message: '판매 사진을 변경했습니다.',
                }),
              )
              .catch((e) => pipe.send({ kind: 'notice', message: e.message }));
        },
      });
      pipe.setPcState({
        ...pcState(session.id, session.displayCode),
        running: true,
      });
      bridge.current = pipe;
      await pipe.start();
      worker.current = new TouchPcWorker({
        api,
        producerId: producer.current,
        frames: frames.current,
        serverOffset: () => serverOffset.current,
        delaySeconds: () => live.current.delay.seconds,
        prepareSeconds: () => live.current.settings.prepareSeconds,
        sessionLabel: () => live.current.activeSession?.displayCode || '',
        canPrint: () => runtime.commentStreamService.isConnectedToServer,
        print: (payload) => runtime.commentStreamService.printSale(payload),
        onChange: () => {
          void refresh().catch(() => {});
        },
        onError: report,
      });
      worker.current.start();
      telemetry?.log('START', session.id, producer.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : '판매를 시작하지 못했습니다.');
      cleanup();
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!api || !activeSession) return;
    setBusy(true);
    try {
      await api.run(
        'STOP',
        producer.current,
        activeSession.id,
        settings,
        pcState(activeSession.id, activeSession.displayCode),
      );
      telemetry?.log(
        'SUMMARY',
        activeSession.id,
        producer.current,
        metrics.current,
      );
      metrics.current = {};
      telemetry?.log('STOP', activeSession.id, producer.current);
      cleanup();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const state = activeSession
    ? pcState(activeSession.id, activeSession.displayCode)
    : null;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-slate-900">댓글터치 판매</h1>
            <p className="mt-1 text-sm text-slate-500">
              폰에서 구매자와 가격을 정하면 PC가 전표와 상품 사진을 준비합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-xl border px-4 py-2 font-bold"
              onClick={() => setShowQr(!showQr)}
            >
              판매 폰 열기
            </button>
            {runningSession ? (
              <button
                disabled={busy}
                className="rounded-xl bg-rose-600 px-4 py-2 font-bold text-white"
                onClick={() => void stop()}
              >
                판매 중지
              </button>
            ) : (
              <>
                <button
                  disabled={busy}
                  className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                  onClick={() => void start('NEW')}
                >
                  {busy ? '연결 중…' : '새 회차 판매 시작'}
                </button>
                {activeSession && (
                  <button
                    disabled={busy}
                    className="rounded-xl border px-4 py-2 font-bold"
                    onClick={() => void start('CONTINUE')}
                  >
                    현재 회차 이어하기
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
          >
            {error}
          </p>
        )}
        {showQr && (
          <div className="mt-4 flex flex-wrap items-center gap-5 rounded-xl bg-blue-50 p-4">
            {qr && (
              <img
                src={qr}
                alt="VoiceCAP 판매 웹앱 열기 QR"
                width="180"
                height="180"
              />
            )}
            <div>
              <strong>VoiceCAP 판매</strong>
              <p className="my-2 text-sm">
                폰에서 같은 판매자 계정으로 로그인하세요.
              </p>
              <a
                className="text-blue-700 underline"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                {url}
              </a>
              <p className="mt-2 text-xs text-slate-600">
                브라우저 메뉴에서 홈 화면에 추가할 수 있습니다.
              </p>
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          {[
            [
              '판매 폰',
              transport === 'DIRECT'
                ? '직접'
                : transport === 'FALLBACK'
                  ? '예비'
                  : '미연결',
              phoneCount > 0,
            ],
            [
              '댓글',
              comments.serverStatus,
              comments.serverStatus === 'COLLECTING',
            ],
            [
              '프린터',
              runtime.commentStreamService.isConnectedToServer
                ? '도우미 연결'
                : '미연결',
              runtime.commentStreamService.isConnectedToServer,
            ],
            ['화면 공유', screenConnected ? '연결' : '없음', screenConnected],
            [
              '틱톡 지연',
              `${delay.seconds.toFixed(1)}초 ${delay.source === 'AUTO' ? '자동' : delay.source === 'LAST' ? '최근 측정값' : '설정값'}`,
              true,
            ],
          ].map(([label, value, ok]) => (
            <span
              key={String(label)}
              className={`rounded-lg px-3 py-2 ${ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}
            >
              {label}: {value}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {activeSession?.displayCode || '진행 중 회차 없음'} ·{' '}
          {settings.captureOff
            ? '캡처 안 함 · 화면 공유 없이 판매'
            : `사진은 확정 ${settings.prepareSeconds}초 + 방송 지연 뒤 저장`}{' '}
          · 판매 방식{' '}
          {TOUCH_SALES_MODES.find((m) => m.value === (settings.salesMode || 'BASIC'))?.label}{' '}
          · 음성인식·AI 판매 판단 사용 안 함
        </p>
        <p className="mt-2 text-xs text-slate-500">
          프린터 준비 여부는 도우미 연결 기준이며, 실제 출력 오류는 각 판매에
          표시됩니다.
        </p>
      </div>
      {!runningSession && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 text-sm">
          <label>
            판매 방식{' '}
            <select
              aria-label="판매 방식"
              className="rounded border p-2"
              value={settings.salesMode || 'BASIC'}
              onChange={(e) =>
                void save({
                  ...settings,
                  salesMode: e.target.value as TouchSalesMode,
                }).catch((e) => setError(e.message))
              }
            >
              {TOUCH_SALES_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              aria-label="캡처 안 함"
              type="checkbox"
              checked={settings.captureOff === true}
              onChange={(e) =>
                void save({ ...settings, captureOff: e.target.checked }).catch(
                  (e) => setError(e.message),
                )
              }
            />{' '}
            캡처 안 함
          </label>
          <label>
            상품 준비{' '}
            <input
              aria-label="상품 준비 초"
              className="w-16 rounded border p-2"
              type="number"
              min="2"
              max="10"
              disabled={settings.captureOff === true}
              value={settings.prepareSeconds}
              onChange={(e) =>
                void save({
                  ...settings,
                  prepareSeconds: Math.max(
                    2,
                    Math.min(10, Number(e.target.value)),
                  ),
                }).catch((e) => setError(e.message))
              }
            />{' '}
            초
          </label>
          <label>
            기본 방송 지연{' '}
            <input
              aria-label="방송 지연 초"
              className="w-16 rounded border p-2"
              type="number"
              min="0"
              max="20"
              value={settings.fallbackDelaySeconds}
              onChange={(e) => {
                const seconds = Math.max(
                  0,
                  Math.min(20, Number(e.target.value)),
                );
                setDelay({ seconds, source: 'SETTING' });
                void save({ ...settings, fallbackDelaySeconds: seconds }).catch(
                  (e) => setError(e.message),
                );
              }}
            />{' '}
            초
          </label>
          <Link className="text-blue-700 underline" to="/helper">
            댓글 도우미·캡처 영역 설정
          </Link>
        </div>
      )}
      <div className="flex gap-3 text-sm">
        <Link
          className="rounded-xl border bg-white px-4 py-3 font-bold"
          to="/seller/product-sales"
        >
          PC 수동 판매 등록
        </Link>
        <Link
          className="rounded-xl border bg-white px-4 py-3 font-bold"
          to="/sales"
        >
          전체 판매내역
        </Link>
        {activeSession && !runningSession && (
          <button
            className="rounded-xl border bg-white px-4 py-3"
            onClick={() => {
              if (
                confirm(
                  '이 회차를 종료할까요? 폰에서 신규 판매를 저장할 수 없게 됩니다.',
                )
              )
                void productSalesApi
                  .endSession(
                    crypto.randomUUID(),
                    activeSession.id,
                    activeSession.revision,
                  )
                  .then(() => loadBootstrap())
                  .catch((e) => setError(e.message));
            }}
          >
            회차 종료
          </button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="mb-3 font-black">
            판매 내역 · 확인 대기{' '}
            <span className="text-blue-700">
              {state?.totalCount || 0}건 /{' '}
              {(state?.totalAmount || 0).toLocaleString()}원
            </span>
          </h2>
          {!records.length && (
            <p className="py-8 text-center text-sm text-slate-400">
              폰에서 댓글과 가격을 확정하면 이곳에 표시됩니다.
            </p>
          )}
          <div className="max-h-[600px] overflow-auto">
            {records.map((sale, i) => (
              <div
                key={sale.id}
                className="flex items-center gap-3 border-b py-3"
              >
                {sale.imageUrl ? (
                  <img
                    className="h-16 w-16 rounded-lg object-cover"
                    src={sale.imageUrl}
                    alt={`${sale.buyerNickname} 상품 사진`}
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">
                    {sale.captureStatus === 'PENDING'
                      ? '촬영 대기'
                      : '사진 없음'}
                  </div>
                )}
                <div className="flex-1">
                  <Link to={`/sales/${sale.id}`} className="font-bold">
                    {String(records.length - i).padStart(3, '0')}{' '}
                    {sale.buyerNickname} · {sale.amount.toLocaleString()}원
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    앱 · {sale.status} · 전표{' '}
                    {sale.printStatus === 'PRINTED'
                      ? '출력됨'
                      : sale.printStatus === 'FAILED'
                        ? '실패'
                        : '대기'}{' '}
                    ·{' '}
                    {sale.captureStatus === 'PENDING'
                      ? `${Math.max(0, Math.ceil((Date.parse(sale.captureDueAt) - Date.now() - serverOffset.current) / 1000))}초 뒤 촬영`
                      : sale.captureStatus === 'CAPTURED'
                        ? '캡처 완료'
                        : '캡처 없음'}
                  </p>
                </div>
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() =>
                    void worker.current
                      ?.getCandidates(sale.id)
                      .then((items) =>
                        setCandidates({ saleId: sale.id, frames: items }),
                      )
                  }
                >
                  다른 장면
                </button>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="mb-3 font-black">
            실시간 댓글 {comments.liveComments.length}개
          </h2>
          <div className="max-h-[600px] overflow-auto">
            {comments.liveComments.map((c) => (
              <div key={c.id} className="border-b py-3">
                <strong className="text-sm">{c.nickname}</strong>
                <span className="ml-2 text-xs text-slate-400">
                  {new Date(c.capturedAt).toLocaleTimeString('ko-KR')}
                </span>
                <p className="text-sm">
                  {c.content}{' '}
                  <span className="text-xs text-slate-500">
                    {stats ? customerStatsLabel(stats.lookup(c)) : ''}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
      {candidates && (
        <div
          role="dialog"
          aria-label="다른 장면 선택"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-5"
        >
          <div className="max-w-2xl rounded-2xl bg-white p-5">
            <h2 className="font-bold">다른 장면 · PC에 24시간 보관</h2>
            <div className="my-4 flex gap-3">
              {candidates.frames.map((f, i) => (
                <button
                  key={f.at}
                  onClick={() => {
                    void worker.current
                      ?.chooseFrame(candidates.saleId, i)
                      .then(() => setCandidates(null))
                      .catch((e) => setError(e.message));
                  }}
                >
                  <img
                    className="max-h-64 rounded-lg"
                    src={f.image}
                    alt={`${i === 0 ? '2초 전' : i === 1 ? '기준' : '2초 후'} 장면`}
                  />
                  <span className="text-xs">
                    {new Date(f.at).toLocaleTimeString('ko-KR')}
                  </span>
                </button>
              ))}
            </div>
            {!candidates.frames.length && (
              <p className="my-4 text-sm">남아 있는 예비 장면이 없습니다.</p>
            )}
            <button
              className="rounded-xl border px-4 py-2"
              onClick={() => setCandidates(null)}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
