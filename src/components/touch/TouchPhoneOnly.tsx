import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TouchSalesApi, TouchBootstrap } from '../../services/touchSalesApi';
import type { TouchComment, TouchSettings } from '../../types/touchSales';
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

const producerKey = (workspaceId: string) => `voicecap-phone-producer:${workspaceId}`;
const learnedKey = (workspaceId: string) => `voicecap-phone-printer-learned:${workspaceId}`;
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<TouchSettings | null>(null);
  const [tiktokId, setTiktokId] = useState('');
  const [status, setStatus] = useState<PhoneProducerStatus | null>(null);
  const [printerName, setPrinterName] = useState('');
  const [shot, setShot] = useState<{ dueAt: number; preview?: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const running = !!status && !!producer.current?.running;

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

  useEffect(
    () => () => {
      void producer.current?.stop();
      androidNative()?.selling(false);
    },
    [],
  );

  const capture = useCallback(async (request: PhoneCaptureRequest) => {
    setShot({ dueAt: request.dueAt });
    let stream: MediaStream | null = null;
    try {
      const el = video.current;
      if (!el) throw new Error('카메라 화면을 열지 못했습니다.');
      stream = await startFrontCamera(el, 1280);
      const wait = request.dueAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const frame = await grabSharpestFrame(el, { count: 3, gapMs: 150 });
      setShot({ dueAt: request.dueAt, preview: frame.url });
      const data = await blobToDataUrl(frame.blob);
      setTimeout(() => {
        setShot((s) => (s?.preview === frame.url ? null : s));
        URL.revokeObjectURL(frame.url);
      }, 1200);
      return data;
    } catch (e) {
      setError(`사진을 찍지 못했습니다: ${(e as Error).message}`);
      setShot(null);
      return null;
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
  }, []);

  const connectPrinter = async (pick: boolean) => {
    setError('');
    const p = printer.current;
    if (pick || !(await p.reconnect())) await p.connect();
    setPrinterName(p.name);
    // 연결 알림: M50은 이 명령 뒤에 보내도 되는 양(허용 신호)을 알려 준다.
    await p.send(marklifeCommands.btType());
    // 처음 연결한 폰은 라벨 길이를 한 번 잰다(시험에서 간격 찾기 맞춤이 잘 맞았다).
    if (!read(learnedKey(workspaceId))) {
      await p.send(realignBytes());
      write(learnedKey(workspaceId), String(Date.now()));
    }
    producer.current?.wake();
  };

  const realign = async () => {
    setError('');
    try {
      await printer.current.send(realignBytes());
      write(learnedKey(workspaceId), String(Date.now()));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const start = async (choice: 'NEW' | 'CONTINUE') => {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      const id = tiktokId.trim().replace(/^@/, '');
      if (!id) throw new Error('틱톡 ID를 입력해 주세요.');
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
        settings: { ...settings, mode: 'COMMENT_TOUCH', tiktokId: id },
        printer: printer.current,
        serverOffset: props.serverOffset,
        totals: props.totals,
        label: (content) => saleLabelBytes(content, canvas.current || undefined),
        capture,
        onComments: props.onComments,
        onStatus: (s) => setStatus(s),
        onError: (kind, e) => {
          if (kind === 'LEASE_LOST') {
            setError('다른 기기(PC 또는 다른 폰)로 판매 연결이 바뀌어 이 폰의 판매를 멈췄습니다.');
            setStatus(null);
            props.onRunningChange(false);
            androidNative()?.selling(false);
          } else if (kind === 'PRINT_ERROR') setError(`전표 인쇄 실패: ${(e as Error)?.message || ''}`);
        },
        onChange: () => void props.refresh(),
      });
      await p.start();
      producer.current = p;
      props.onRunningChange(true);
      androidNative()?.selling(true);
      setOpen(false);
      await props.refresh();
    } catch (e) {
      const code = (e as any)?.code;
      setError(
        code === 'PC_ALREADY_RUNNING'
          ? 'PC에서 판매 중입니다. PC 판매를 멈춘 뒤 다시 시도해 주세요.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
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

  const overlay = (
    <>
      <canvas ref={canvas} hidden />
      <div className={shot ? 'touch-phone-shot' : 'touch-phone-shot touch-phone-shot-idle'} aria-hidden={!shot}>
        <video ref={video} playsInline muted />
        {shot && !shot.preview && (
          <strong>{Math.max(0, Math.ceil((shot.dueAt - now) / 1000)) || '찰칵'}</strong>
        )}
        {shot?.preview && <img src={shot.preview} alt="방금 찍은 판매 사진" />}
      </div>
    </>
  );

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
          <span className={status.printer.connected ? 'ok' : 'warn'}>
            프린터 ● {status.printer.connected ? status.printer.name || printerName || '연결' : '끊김'}
            {status.printer.printing ? ' · 인쇄 중' : ''}
          </span>
          {!status.printer.connected ? (
            <button onClick={() => void connectPrinter(false).catch((e) => setError(e.message))}>
              프린터 연결
            </button>
          ) : (
            <button onClick={() => void realign()}>라벨 다시 맞추기</button>
          )}
          <button className="touch-phone-stop" disabled={busy} onClick={() => void stop()}>
            판매 멈춤
          </button>
        </div>
        {error && (
          <p role="alert" className="touch-error touch-page-error">
            {error}
          </p>
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
              댓글은 이 폰이 직접 받습니다. 전표는 블루투스 라벨프린터로 나오고, 판매 사진은{' '}
              {settings?.captureOff
                ? '찍지 않습니다(캡처 안 함).'
                : `${settings?.prepareSeconds ?? 4}초 카운트다운 뒤 앞카메라로 1장 찍습니다.`}
            </p>
            <div className="touch-phone-printer">
              <span>
                프린터 ● {printer.current.connected ? printer.current.name || printerName || '연결됨' : '연결 안 됨'}
              </span>
              <button
                disabled={busy}
                onClick={() => void connectPrinter(true).catch((e) => setError(e.message))}
              >
                {printer.current.connected ? '다른 프린터' : '프린터 연결'}
              </button>
            </div>
            {error && (
              <p role="alert" className="touch-error">
                {error}
              </p>
            )}
            {bootstrap?.session && (
              <button className="touch-primary" disabled={busy || !settings} onClick={() => void start('CONTINUE')}>
                지금 회차 이어서 판매
              </button>
            )}
            <button
              className={bootstrap?.session ? '' : 'touch-primary'}
              disabled={busy || !settings}
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
