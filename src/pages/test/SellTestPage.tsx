import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LABEL_HEIGHT_PX,
  LABEL_WIDTH_PX,
  PAPER_CONTINUOUS,
  PAPER_GAP,
  buildPrintJob,
  type LabelAlign,
  marklifeCommands,
  packBitmap,
} from '../../services/labelPrinter/marklifeProtocol';
import { drawSaleLabel } from '../../services/labelPrinter/labelDraw';
import {
  WebBluetoothPrinter,
  webBluetoothAvailable,
  type SendMode,
} from '../../services/labelPrinter/webBluetoothPrinter';
import {
  grabSharpestFrame,
  startFrontCamera,
  type GrabbedFrame,
} from '../../services/frontCamera';

const SETTINGS_KEY = 'voicecap-sell-test-settings';
type Settings = {
  buyer: string;
  amount: number;
  productLabel: string;
  density: number;
  speed: number;
  paper: number;
  copies: number;
  mode: SendMode;
  delayMs: number;
  chunkSize: number;
  threshold: number;
  align: LabelAlign;
  pitchMm: number;
  seconds: number;
};
const DEFAULTS: Settings = {
  buyer: '꽃심이',
  amount: 15000,
  productLabel: '2번',
  density: 3,
  speed: 1,
  paper: PAPER_GAP,
  copies: 1,
  mode: 'AUTO',
  delayMs: 30,
  chunkSize: 90,
  threshold: 160,
  align: 'FIXED',
  pitchMm: 38,
  seconds: 4,
};
const loadSettings = (): Settings => {
  try {
    return {
      ...DEFAULTS,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
    };
  } catch {
    return DEFAULTS;
  }
};

const now = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
    {label}
    {children}
  </label>
);
const input =
  'rounded-lg border border-slate-300 px-2 py-2 text-base font-normal text-slate-900';
const btn =
  'rounded-xl px-3 py-3 text-sm font-bold disabled:opacity-40 bg-slate-100 text-slate-800 active:bg-slate-200';
const primary =
  'rounded-xl px-3 py-3 text-sm font-bold disabled:opacity-40 bg-blue-600 text-white active:bg-blue-700';

const SellTestPage: React.FC = () => {
  const [s, setS] = useState<Settings>(loadSettings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  }, [s]);

  const [log, setLog] = useState<string[]>([]);
  const addLog = useCallback(
    (line: string) =>
      setLog((prev) => [...prev.slice(-199), `${now()} ${line}`]),
    [],
  );
  const printer = useRef<WebBluetoothPrinter | null>(null);
  if (!printer.current) printer.current = new WebBluetoothPrinter(addLog);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [printResults, setPrintResults] = useState<string[]>([]);
  const preview = useRef<HTMLCanvasElement>(null);
  const label = useRef<HTMLCanvasElement | null>(null);

  // Preview shows what the printer gets: the label after the black/white cut.
  useEffect(() => {
    if (!label.current) label.current = document.createElement('canvas');
    const image = drawSaleLabel(label.current, {
      buyer: s.buyer,
      amount: s.amount,
      productLabel: s.productLabel.trim() || undefined,
    });
    const bits = packBitmap(image.data, image.width, image.height, s.threshold);
    const canvas = preview.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    const out = ctx.createImageData(image.width, image.height);
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const on = bits.data[y * bits.rowBytes + (x >> 3)] & (0x80 >> (x & 7));
        const i = (y * image.width + x) * 4;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = on ? 0 : 255;
        out.data[i + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  }, [s.buyer, s.amount, s.productLabel, s.threshold]);

  const run = async (name: string, task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      addLog(
        `${name} 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
      setConnected(!!printer.current?.connected);
    }
  };
  const connect = () =>
    run('연결', async () => {
      await printer.current!.connect();
      await printer.current!.send(marklifeCommands.btType(), { mode: 'TIMED' });
      await sleep(400);
      addLog(
        printer.current!.creditSeen
          ? '허용 신호(FF03)를 받았습니다.'
          : '아직 허용 신호가 없습니다. 시간 간격으로 보냅니다.',
      );
    });
  const sendCommand = (name: string, bytes: Uint8Array) =>
    run(name, async () => {
      addLog(`${name} 보냄`);
      await printer.current!.send(bytes, { mode: 'TIMED' });
    });
  const testPrint = () =>
    run('시험 인쇄', async () => {
      const image = drawSaleLabel(label.current!, {
        buyer: s.buyer,
        amount: s.amount,
        productLabel: s.productLabel.trim() || undefined,
      });
      const bits = packBitmap(
        image.data,
        image.width,
        image.height,
        s.threshold,
      );
      const job = buildPrintJob(bits, {
        paper: s.paper,
        density: s.density,
        speed: s.speed,
        copies: s.copies,
        align: s.align,
        pitchMm: s.pitchMm,
      });
      addLog(
        `인쇄 ${job.length}바이트 (농도 ${s.density}, 속도 ${s.speed}, ${s.paper === PAPER_GAP ? '라벨' : '연속'}, ${s.copies}장, 맞춤 ${s.align}${s.align === 'FIXED' ? ` ${s.pitchMm}mm` : ''})`,
      );
      const ms = await printer.current!.send(
        job,
        { chunkSize: s.chunkSize, mode: s.mode, delayMs: s.delayMs },
        (a, b) => setProgress(`${a}/${b}`),
      );
      setPrintResults((prev) => [
        ...prev,
        `${now()} 맞춤${s.align}${s.align === 'FIXED' ? `/${s.pitchMm}mm` : ''} ${s.copies}장 농도${s.density} 속도${s.speed} ${s.mode}/${s.delayMs}ms 조각${s.chunkSize} → ${ms}ms`,
      ]);
    });

  // ---- front camera ----
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [cameraMs, setCameraMs] = useState<number | null>(null);
  const [cameraOnAt, setCameraOnAt] = useState<number | null>(null);
  const [cameraInfo, setCameraInfo] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [shots, setShots] = useState<(GrabbedFrame & { at: string })[]>([]);
  const [taps, setTaps] = useState(0);
  const [battery, setBattery] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const nav = navigator as unknown as {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    if (tick % 30 !== 0 || !nav.getBattery) return;
    nav
      .getBattery()
      .then((b) =>
        setBattery(
          `${Math.round(b.level * 100)}%${b.charging ? ' 충전 중' : ''}`,
        ),
      )
      .catch(() => undefined);
  }, [tick]);
  useEffect(
    () => () => stream.current?.getTracks().forEach((t) => t.stop()),
    [],
  );

  const cameraOn = async () => {
    const started = performance.now();
    try {
      stream.current = await startFrontCamera(video.current!);
      const ms = Math.round(performance.now() - started);
      setCameraMs(ms);
      setCameraOnAt(Date.now());
      const track = stream.current.getVideoTracks()[0];
      const set = track?.getSettings();
      setCameraInfo(
        `${set?.width}×${set?.height} ${set?.frameRate ? `${Math.round(set.frameRate)}fps` : ''} · ${track?.label || ''}`,
      );
      addLog(`카메라 켜짐 ${ms}ms`);
    } catch (error) {
      addLog(
        `카메라 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const cameraOff = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCameraOnAt(null);
  };
  const shoot = async () => {
    if (!stream.current) await cameraOn();
    if (!stream.current) return;
    setTaps(0);
    for (let n = s.seconds; n > 0; n--) {
      setCount(n);
      await sleep(1000);
    }
    setCount(0);
    try {
      const shot = await grabSharpestFrame(video.current!, {
        count: 3,
        gapMs: 150,
      });
      setShots((prev) => [{ ...shot, at: now() }, ...prev].slice(0, 6));
      addLog(
        `사진 ${shot.width}×${shot.height}, 선명도 ${shot.sharpness} (${shot.candidates.join('/')}), 밝기 ${shot.brightness}`,
      );
    } catch (error) {
      addLog(
        `촬영 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setCount(null);
    }
  };
  const minutesOn = cameraOnAt
    ? Math.floor((Date.now() - cameraOnAt) / 60000)
    : 0;

  const summary = () =>
    [
      `기기: ${navigator.userAgent}`,
      `프린터: ${printer.current?.name || '연결 안 함'}, 허용 신호 ${printer.current?.creditSeen ? '있음' : '없음'}`,
      ...printResults,
      `카메라: ${cameraMs ?? '-'}ms, ${cameraInfo}, 켜진 지 ${minutesOn}분, 배터리 ${battery || '-'}`,
      ...shots.map(
        (p) => `사진 ${p.at} 선명도 ${p.sharpness} 밝기 ${p.brightness}`,
      ),
      '--- 로그 ---',
      ...log.slice(-60),
    ].join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary());
      addLog('결과를 복사했습니다. 대화창에 붙여 넣어 주세요.');
    } catch {
      addLog('복사가 막혔습니다. 아래 로그를 길게 눌러 복사해 주세요.');
    }
  };

  return (
    <main className="mx-auto max-w-xl space-y-4 bg-slate-50 p-4 pb-24 text-slate-900">
      <header>
        <h1 className="text-xl font-black">폰 판매 0단계 시험</h1>
        <p className="text-sm text-slate-600">
          라벨프린터(AbleMark M50)와 앞카메라를 시험합니다. 판매 기록은 남지
          않습니다.
        </p>
      </header>

      <section
        className="space-y-3 rounded-2xl bg-white p-4 shadow-sm"
        aria-label="프린터 시험"
      >
        <h2 className="text-lg font-black">1. 라벨프린터</h2>
        {!webBluetoothAvailable() && (
          <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
            이 브라우저는 블루투스를 지원하지 않습니다. 안드로이드 폰의
            Chrome에서 열어 주세요.
          </p>
        )}
        <p className="text-sm">
          상태:{' '}
          <strong>
            {connected
              ? `연결됨 · ${printer.current?.name || '이름 없음'}`
              : '연결 안 됨'}
          </strong>
          {progress && ` · 보낸 조각 ${progress}`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={primary}
            disabled={busy || connected}
            onClick={connect}
          >
            프린터 찾기·연결
          </button>
          <button
            type="button"
            className={primary}
            disabled={busy || !connected}
            onClick={testPrint}
          >
            시험 인쇄
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy || !connected}
            onClick={() =>
              sendCommand('자가 시험', marklifeCommands.selfTest())
            }
          >
            자가 시험 인쇄
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy || !connected}
            onClick={() =>
              sendCommand('종이 학습', marklifeCommands.learnPaper())
            }
          >
            라벨 간격 학습
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy || !connected}
            onClick={() =>
              sendCommand('다음 라벨로', marklifeCommands.findGap())
            }
          >
            다음 라벨로 넘기기
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy || !connected}
            onClick={() =>
              sendCommand(
                '배터리·버전 조회',
                new Uint8Array([
                  ...marklifeCommands.battery(),
                  ...marklifeCommands.version(),
                  ...marklifeCommands.model(),
                ]),
              )
            }
          >
            배터리·버전 조회
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy || !connected}
            onClick={() => {
              printer.current?.disconnect();
              setConnected(false);
            }}
          >
            연결 끊기
          </button>
        </div>
        <canvas
          ref={preview}
          aria-label="라벨 미리보기"
          className="w-full rounded border border-slate-300 bg-white"
          style={{ aspectRatio: `${LABEL_WIDTH_PX} / ${LABEL_HEIGHT_PX}` }}
        />
        <div className="grid grid-cols-3 gap-2">
          <Field label="구매자">
            <input
              className={input}
              value={s.buyer}
              onChange={(e) => set('buyer', e.target.value)}
            />
          </Field>
          <Field label="금액">
            <input
              className={input}
              inputMode="numeric"
              value={s.amount}
              onChange={(e) =>
                set('amount', Number(e.target.value.replace(/\D/g, '')) || 0)
              }
            />
          </Field>
          <Field label="번호(비우면 없음)">
            <input
              className={input}
              value={s.productLabel}
              onChange={(e) => set('productLabel', e.target.value.slice(0, 6))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="라벨 맞춤">
            <select
              className={input}
              value={s.align}
              onChange={(e) => set('align', e.target.value as LabelAlign)}
            >
              <option value="FIXED">길이만큼 넘김</option>
              <option value="GAP">간격 찾기</option>
              <option value="AUTO">맞춤 없음 (밀림)</option>
            </select>
          </Field>
          <Field label="라벨+간격(mm)">
            <input
              className={input}
              type="number"
              min={20}
              max={80}
              step={0.5}
              disabled={s.align !== 'FIXED'}
              value={s.pitchMm}
              onChange={(e) => set('pitchMm', Number(e.target.value))}
            />
          </Field>
          <Field label="장수">
            <input
              className={input}
              type="number"
              min={1}
              max={5}
              value={s.copies}
              onChange={(e) => set('copies', Number(e.target.value))}
            />
          </Field>
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-bold text-slate-700">
            인쇄 세부 설정
          </summary>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Field label="농도 1~15">
              <input
                className={input}
                type="number"
                min={1}
                max={15}
                value={s.density}
                onChange={(e) => set('density', Number(e.target.value))}
              />
            </Field>
            <Field label="속도 0~2">
              <input
                className={input}
                type="number"
                min={0}
                max={2}
                value={s.speed}
                onChange={(e) => set('speed', Number(e.target.value))}
              />
            </Field>
            <Field label="종이">
              <select
                className={input}
                value={s.paper}
                onChange={(e) => set('paper', Number(e.target.value))}
              >
                <option value={PAPER_GAP}>간격 라벨</option>
                <option value={PAPER_CONTINUOUS}>연속 용지</option>
              </select>
            </Field>
            <Field label="보내는 방식">
              <select
                className={input}
                value={s.mode}
                onChange={(e) => set('mode', e.target.value as SendMode)}
              >
                <option value="AUTO">자동</option>
                <option value="CREDIT">허용 신호 기다림</option>
                <option value="TIMED">시간 간격</option>
              </select>
            </Field>
            <Field label="간격(ms)">
              <input
                className={input}
                type="number"
                min={0}
                max={200}
                value={s.delayMs}
                onChange={(e) => set('delayMs', Number(e.target.value))}
              />
            </Field>
            <Field label="조각 크기">
              <input
                className={input}
                type="number"
                min={20}
                max={500}
                value={s.chunkSize}
                onChange={(e) => set('chunkSize', Number(e.target.value))}
              />
            </Field>
            <Field label="흑백 기준">
              <input
                className={input}
                type="number"
                min={60}
                max={240}
                value={s.threshold}
                onChange={(e) => set('threshold', Number(e.target.value))}
              />
            </Field>
          </div>
        </details>
      </section>

      <section
        className="space-y-3 rounded-2xl bg-white p-4 shadow-sm"
        aria-label="카메라 시험"
      >
        <h2 className="text-lg font-black">2. 앞카메라</h2>
        <div
          className="relative overflow-hidden rounded-xl bg-black"
          style={{ aspectRatio: '4 / 3' }}
        >
          <video
            ref={video}
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
            playsInline
            muted
          />
          {count !== null && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/20 text-8xl font-black text-white"
              style={{ textShadow: '0 2px 12px #000' }}
            >
              {count || '찰칵'}
            </div>
          )}
          {!cameraOnAt && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
              카메라 꺼짐
            </p>
          )}
        </div>
        <p className="text-sm text-slate-600">
          {cameraMs !== null
            ? `켜지는 데 ${cameraMs}ms · ${cameraInfo}`
            : '카메라를 켜면 켜지는 시간과 화질이 나옵니다.'}
          {cameraOnAt && ` · 켜진 지 ${minutesOn}분`}
          {battery && ` · 배터리 ${battery}`}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            className={btn}
            onClick={cameraOnAt ? cameraOff : cameraOn}
          >
            {cameraOnAt ? '카메라 끄기' : '카메라 켜기'}
          </button>
          <Field label="카운트다운(초)">
            <select
              className={input}
              value={s.seconds}
              onChange={(e) => set('seconds', Number(e.target.value))}
            >
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}초
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className={primary}
            disabled={count !== null}
            onClick={shoot}
          >
            촬영 시험
          </button>
        </div>
        <div>
          <p className="text-xs text-slate-500">
            카운트다운 중에도 눌리는지 확인: 아래 가짜 댓글을 눌러 보세요.
          </p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {['저요', '1번이요', 'ㅈㅇ'].map((text) => (
              <button
                key={text}
                type="button"
                className={btn}
                onClick={() => setTaps((n) => n + 1)}
              >
                {text}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-600">눌린 횟수 {taps}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {shots.map((shot) => (
            <figure key={shot.url} className="text-xs text-slate-600">
              <img
                src={shot.url}
                alt={`시험 사진 ${shot.at}`}
                className="w-full rounded"
              />
              <figcaption>
                {shot.at} · 선명도 {shot.sharpness}
                {shot.brightness < 60 ? ' · 어두움' : ''}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section
        className="space-y-2 rounded-2xl bg-white p-4 shadow-sm"
        aria-label="시험 기록"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">3. 결과 보내기</h2>
          <button type="button" className={primary} onClick={copy}>
            결과 복사
          </button>
        </div>
        <pre
          className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[11px] text-slate-100"
          aria-label="로그"
        >
          {log.join('\n') || '아직 기록이 없습니다.'}
        </pre>
      </section>
    </main>
  );
};

export default SellTestPage;
