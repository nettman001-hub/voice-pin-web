import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  TouchSalesApi,
  type TouchBootstrap,
} from '../../services/touchSalesApi';
import { TouchSalesBridge } from '../../services/touchSalesBridge';
import { classifyTouchSaveFailure } from '../../services/touchSaveFailure';
import {
  touchLocalStore,
  flushTouchOutbox,
  type TouchOutboxItem,
} from '../../services/touchLocalStore';
import {
  selectTouchComment,
  touchCommentKey,
  mergeTouchComments,
  type TouchSelectionState,
} from '../../services/touchCommentState';
import {
  AudioEnvelopeSampler,
  type EnvelopeSample,
} from '../../services/touchDelayEstimator';
import { requireSupabase } from '../../services/supabaseClient';
import { TouchCommentList } from '../../components/touch/TouchCommentList';
import { TouchPricePad } from '../../components/touch/TouchPricePad';
import { customerStatsLabel } from '../../services/customerStatsIndex';
import { productSalesApi } from '../../services/productSalesApi';
import { measureTouchClock } from '../../services/touchClock';
import type {
  TouchComment,
  TouchCommit,
  TouchPcState,
  TouchSale,
  TouchSalesMode,
  TouchTransport,
} from '../../types/touchSales';
import type { TouchFrame } from '../../services/touchFrameBuffer';
import type { Buyer } from '../../types/productSales';
import { touchLogoutWarning } from '../../services/touchAccount';
import {
  nextUnsoldNumber,
  touchLabelNumber,
  touchModeUsesNumber,
  touchProductLabel,
  touchSlipLine,
} from '../../services/touchSaleModes';
import {
  TouchNumberBar,
  TouchRecentSaleCard,
} from '../../components/touch/TouchSaleModeParts';
import { TouchPhoneOnly } from '../../components/touch/TouchPhoneOnly';
import { isSalesApp } from '../../services/labelPrinter/androidBridge';
import '../../styles/touchSales.css';

const printLabel = (status: string) =>
  status === 'PRINTED'
    ? '전표 출력됨'
    : status === 'FAILED'
      ? '전표 확인 필요'
      : '전표 대기';
export default function TouchMobileSalesPage() {
  const salesApp = isSalesApp();
  const { workspaceId, user, logout } = useAuth();
  const api = useMemo(
    () => new TouchSalesApi(workspaceId || ''),
    [workspaceId],
  );
  const [bootstrap, setBootstrap] = useState<TouchBootstrap | null>(null),
    [pc, setPc] = useState<TouchPcState | null>(null),
    [transport, setTransport] = useState<TouchTransport>('DISCONNECTED');
  const [comments, setComments] = useState<TouchComment[]>([]),
    [tab, setTab] = useState<'SELL' | 'HISTORY'>('SELL'),
    [grouped, setGrouped] = useState(false);
  const [archiveRows, setArchiveRows] = useState<TouchComment[]>([]),
    [selectedSnapshot, setSelectedSnapshot] = useState<TouchComment | null>(
      null,
    );
  const archiveQuery = useRef('');
  const [selection, setSelection] = useState<TouchSelectionState>({
      selectedKey: null,
      acknowledged: new Set(),
    }),
    [priceComment, setPriceComment] = useState<TouchComment | null>(null);
  const [outbox, setOutbox] = useState<TouchOutboxItem[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [accountOpen, setAccountOpen] = useState(false),
    [logoutConfirm, setLogoutConfirm] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null),
    [editPrice, setEditPrice] = useState(false),
    [buyers, setBuyers] = useState<Buyer[] | null>(null),
    [buyerSearch, setBuyerSearch] = useState('');
  const [candidates, setCandidates] = useState<{
      saleId: string;
      frames: TouchFrame[];
    } | null>(null),
    [micEnabled, setMicEnabled] = useState(false),
    [micStatus, setMicStatus] = useState('');
  const [reprint, setReprint] = useState(true),
    [recent, setRecent] = useState<string[]>([]),
    [tick, setTick] = useState(0);
  const [detailMeta, setDetailMeta] = useState<{
    history: any[];
    settlementUsed: boolean;
    entryContext: Record<string, unknown>;
  } | null>(null);
  // 판매 방식(상품번호·사이즈·색상): 위쪽 번호, 여러 명 고르기, 방금 판매 칸.
  const [currentNumber, setCurrentNumber] = useState(1),
    [returnNumber, setReturnNumber] = useState<number | null>(null),
    [picked, setPicked] = useState<TouchComment[]>([]),
    [batch, setBatch] = useState<{
      comments: TouchComment[];
      number: number;
      priceChange: boolean;
    } | null>(null),
    [recentSale, setRecentSale] = useState<{
      saleIds: string[];
      label: string;
    } | null>(null),
    [cardPrice, setCardPrice] = useState(false);
  const pipe = useRef<TouchSalesBridge | null>(null),
    sampler = useRef(new AudioEnvelopeSampler()),
    serverOffset = useRef(0),
    flushBusy = useRef(false),
    mounted = useRef(true);
  const submission = useRef(false),
    refreshFlight = useRef<Promise<void> | null>(null),
    refreshDirty = useRef(false),
    sessionRef = useRef(''),
    producerRef = useRef('');
  const measuredClock = useRef(false);
  const [phoneRunning, setPhoneRunning] = useState(false);
  const phoneTotals = useRef({ totalCount: 0, totalAmount: 0 });
  const rows = (bootstrap?.sales || []).filter(
      (s) => s.reviewDecision !== 'NOT_SALE',
    ),
    sessionId = bootstrap?.session?.id || pc?.sessionId || '';
  const detail = rows.find((s) => s.id === detailId);
  const pendingSaveError = outbox
    .filter((item) => item.error && !item.blocked)
    .map((item) => classifyTouchSaveFailure({ code: item.code, message: item.error }))
    .find((failure) => failure.kind !== 'NETWORK')?.message || '';
  useEffect(() => {
    let active = true;
    setDetailMeta(null);
    if (detailId)
      void api
        .detail(detailId)
        .then((value) => {
          if (active) setDetailMeta(value);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, detailId, detail?.revision]);
  const activeRows = rows.filter(
    (s) =>
      !['보류', '취소'].includes(s.status) && s.recordState !== 'CANCELLED',
  );
  const total = activeRows.reduce((n, s) => n + s.amount, 0);
  const enabled =
    !!sessionId &&
    !!bootstrap?.run?.running &&
    bootstrap.run.session_id === sessionId;
  const runSettings = bootstrap?.run?.settings;
  const salesMode: TouchSalesMode = runSettings?.salesMode || 'BASIC',
    captureOff = runSettings?.captureOff === true,
    multi = touchModeUsesNumber(salesMode);
  const numberInfo = useMemo(() => {
    const map = new Map<number, { unitPrice: number }>();
    // rows는 최근 판매가 먼저이므로 처음 본 가격이 그 번호의 마지막 가격이다.
    for (const s of activeRows) {
      const n = touchLabelNumber(s.productName);
      if (n !== null && !map.has(n)) map.set(n, { unitPrice: s.unitPrice });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap]);
  const soldNumbers = useMemo(() => new Set(numberInfo.keys()), [numberInfo]);
  useEffect(() => {
    if (!sessionId) return;
    try {
      const saved = Number(
        localStorage.getItem(`voicecap-touch-number:${sessionId}`),
      );
      setCurrentNumber(saved >= 1 && saved <= 999 ? saved : 1);
    } catch {
      setCurrentNumber(1);
    }
    setReturnNumber(null);
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem(
        `voicecap-touch-number:${sessionId}`,
        String(returnNumber ?? currentNumber),
      );
    } catch {}
  }, [sessionId, currentNumber, returnNumber]);
  const changeNumber = (n: number) => {
    // 지난 번호로 바꾸면 판매 뒤 원래 번호로 돌아온다.
    if (numberInfo.has(n) && !numberInfo.has(currentNumber))
      setReturnNumber(currentNumber);
    else if (!numberInfo.has(n)) setReturnNumber(null);
    setCurrentNumber(n);
  };
  const refresh = useCallback(() => {
    if (refreshFlight.current) {
      refreshDirty.current = true;
      return refreshFlight.current;
    }
    refreshFlight.current = (async () => {
      do {
        refreshDirty.current = false;
        const started = Date.now();
        const value = await api.bootstrap();
        if (!mounted.current) return;
        if (!measuredClock.current)
          serverOffset.current = value.serverNow - (started + Date.now()) / 2;
        setBootstrap(value);
        if (sessionRef.current && value.session?.id !== sessionRef.current) {
          setComments([]);
          setArchiveRows([]);
          setSelectedSnapshot(null);
          setSelection({ selectedKey: null, acknowledged: new Set() });
          setPriceComment(null);
          setPicked([]);
          setBatch(null);
          setRecentSale(null);
        }
        sessionRef.current = value.session?.id || '';
      } while (mounted.current && refreshDirty.current);
    })().finally(() => {
      refreshFlight.current = null;
    });
    return refreshFlight.current;
  }, [api]);
  const reloadOutbox = useCallback(async () => {
    const value = await touchLocalStore.listOutbox(api.workspaceId);
    if (mounted.current) setOutbox(value);
  }, [api]);
  const flush = useCallback(async () => {
    if (flushBusy.current) return;
    flushBusy.current = true;
    try {
      if (
        !(await touchLocalStore.listOutbox(api.workspaceId)).some(
          (item) => !item.blocked,
        )
      )
        return;
      await flushTouchOutbox(
        touchLocalStore,
        api.workspaceId,
        (sale) => api.commit(sale),
        () => mounted.current,
      );
      await reloadOutbox();
      await refresh();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      flushBusy.current = false;
    }
  }, [api, reloadOutbox, refresh]);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = () => void refresh().catch((e) => setError(e.message));
    start();
    void reloadOutbox();
    const syncClock = () =>
      void measureTouchClock(() => api.clock())
        .then((value) => {
          if (mounted.current && value) {
            serverOffset.current = value.offset;
            measuredClock.current = true;
          }
        })
        .catch(() => {});
    syncClock();
    const bridge = salesApp ? null : new TouchSalesBridge({
      workspaceId: api.workspaceId,
      role: 'PHONE',
      onStatus: (status) => {
        setTransport(status);
        if (status !== 'DISCONNECTED') void flush();
      },
      onPacket: (packet) => {
        if (packet.kind === 'state' && packet.state) {
          if (
            producerRef.current &&
            producerRef.current !== packet.state.producerId
          ) {
            setComments([]);
            setArchiveRows([]);
          }
          producerRef.current = packet.state.producerId;
          setPc(packet.state);
          if (packet.state.sessionId !== sessionRef.current)
            void refresh().catch(() => {});
        }
        if (packet.kind === 'comments' && Array.isArray(packet.items)) {
          if (packet.state) setPc(packet.state);
          if (packet.sessionId === sessionRef.current)
            setComments((old) =>
              mergeTouchComments(old, packet.items, packet.sessionId),
            );
          else
            void refresh()
              .then(() => {
                if (packet.sessionId === sessionRef.current)
                  setComments((old) =>
                    mergeTouchComments(old, packet.items, packet.sessionId),
                  );
              })
              .catch(() => {});
        }
        if (
          packet.kind === 'search-results' &&
          packet.query === archiveQuery.current &&
          packet.sessionId === sessionRef.current
        )
          setArchiveRows((old) =>
            mergeTouchComments(
              packet.reset ? [] : old,
              packet.items,
              packet.sessionId,
            ),
          );
        if (packet.kind === 'candidates' && Array.isArray(packet.frames))
          setCandidates({ saleId: packet.saleId, frames: packet.frames });
        if (packet.kind === 'notice') {
          setNotice(packet.message);
          setCandidates(null);
          void refresh();
        }
        if (packet.kind === 'busy')
          setError(
            '다른 판매 폰이 연결되어 있습니다. 기존 폰의 판매 화면을 닫은 뒤 다시 연결해 주세요.',
          );
      },
    });
    pipe.current = bridge;
    if (bridge) void bridge.start().catch((e) => setError(e.message));
    const channel = requireSupabase().channel(
      `touch-phone-sales:${api.workspaceId}:${crypto.randomUUID()}`,
    );
    for (const table of [
      'sales',
      'touch_sale_details',
      'touch_sales_runs',
      'live_sessions',
    ])
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `workspace_id=eq.${api.workspaceId}`,
        },
        () => {
          if (!timer)
            timer = setTimeout(() => {
              timer = null;
              start();
            }, 300);
        },
      );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') start();
    });
    const wake = () => {
      if (document.visibilityState === 'visible') {
        start();
        syncClock();
        bridge?.send({ kind: 'resync' });
        void flush();
      }
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    const retry = setInterval(() => {
      if (document.visibilityState === 'visible') void flush();
    }, 10000);
    return () => {
      mounted.current = false;
      if (timer) clearTimeout(timer);
      clearInterval(retry);
      bridge?.stop();
      pipe.current = null;
      sampler.current.stop();
      void requireSupabase().removeChannel(channel);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [api, refresh, flush, reloadOutbox, salesApp]);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (tab !== 'SELL') return;
    let lock: any = null,
      active = true;
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const value = await (navigator as any).wakeLock?.request('screen');
        if (active) lock = value;
        else await value?.release();
      } catch {}
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      active = false;
      void lock?.release();
      document.removeEventListener('visibilitychange', acquire);
    };
  }, [tab]);
  useEffect(() => {
    if (salesApp || !micEnabled || transport !== 'DIRECT') return;
    let cancelled = false,
      starting = false;
    const samples: EnvelopeSample[] = [];
    const startMic = async () => {
      if (document.visibilityState !== 'visible' || cancelled || starting)
        return;
      starting = true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        await sampler.current.start(
          stream,
          (sample) => {
            samples.push({
              at: sample.at + (pipe.current?.clockOffsetMs || 0),
              value: sample.value,
            });
          },
          true,
        );
        setMicStatus('지연 자동 측정 중');
      } catch {
        if (!cancelled) setMicStatus('마이크 사용 불가 · PC 설정값으로 촬영');
      } finally {
        starting = false;
      }
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') sampler.current.stop();
      else void startMic();
    };
    void startMic();
    document.addEventListener('visibilitychange', visibility);
    const send = setInterval(() => {
      if (samples.length)
        pipe.current?.send({ kind: 'audio', samples: samples.splice(0, 30) });
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(send);
      sampler.current.stop();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [micEnabled, transport, salesApp]);
  useEffect(() => {
    try {
      setRecent(
        JSON.parse(
          localStorage.getItem(`voicecap-touch-recent:${workspaceId}`) || '[]',
        ),
      );
    } catch {}
  }, [workspaceId]);
  const sold = useMemo(
    () =>
      new Map(
        rows
          .filter((s) => s.comment?.platformMessageId)
          .map((s, i) => [
            `${s.sessionId}:${s.comment.platformMessageId}`,
            String(rows.length - i).padStart(3, '0'),
          ]),
      ),
    [rows],
  );
  const displayComments = archiveQuery.current
    ? mergeTouchComments(
        archiveRows,
        comments.filter(
          (c) =>
            c.nickname
              .toLocaleLowerCase()
              .includes(archiveQuery.current.toLocaleLowerCase()) ||
            (c.uniqueId || '')
              .toLocaleLowerCase()
              .includes(archiveQuery.current.toLocaleLowerCase()),
        ),
        sessionId,
      )
    : comments;
  const selected =
    comments.find((c) => touchCommentKey(c) === selection.selectedKey) ||
    (selectedSnapshot &&
    touchCommentKey(selectedSnapshot) === selection.selectedKey
      ? selectedSnapshot
      : null);
  const searchArchive = useCallback((query: string) => {
    archiveQuery.current = query;
    if (!query) setArchiveRows([]);
    else pipe.current?.send({ kind: 'search-comments', query });
  }, []);
  const submit = async (
    inputPrice: string,
    unitPrice: number,
    quantity: number,
  ) => {
    if (submission.current || !priceComment || !sessionId) return;
    const pending = outbox.find(
      (i) =>
        i.sale.comment.platformMessageId ===
        (priceComment.platformMessageId || priceComment.id),
    );
    if (pending) {
      setNotice(
        '이 댓글의 저장 요청이 이미 있습니다. 판매내역의 보내는 중 항목을 확인해 주세요.',
      );
      setPriceComment(null);
      setTab('HISTORY');
      return;
    }
    const duplicate = rows.find(
      (s) =>
        (priceComment.platformUserId
          ? s.comment?.platformUserId === priceComment.platformUserId
          : priceComment.uniqueId
            ? s.comment?.uniqueId === priceComment.uniqueId
            : !s.comment?.platformUserId &&
              s.buyerNickname === priceComment.nickname) &&
        s.amount === unitPrice * quantity &&
        Date.now() + serverOffset.current - Date.parse(s.recognizedAt) <
          10000 &&
        s.status !== '취소',
    );
    if (
      duplicate &&
      !confirm('방금 같은 구매자·가격의 판매가 있습니다. 하나 더 저장할까요?')
    )
      return;
    submission.current = true;
    setBusy(true);
    setError('');
    const confirmedAt = new Date(
      Date.now() + serverOffset.current,
    ).toISOString();
    const sale: TouchCommit = {
      operationId: crypto.randomUUID(),
      sessionId,
      comment: {
        platformMessageId: priceComment.platformMessageId || priceComment.id,
        platformUserId: priceComment.platformUserId,
        uniqueId: priceComment.uniqueId,
        nickname: priceComment.nickname,
        content: priceComment.content,
        capturedAt: priceComment.capturedAt,
      },
      inputPrice,
      unitPrice,
      quantity,
      productId: pc?.product?.id || bootstrap?.product?.id,
      captureOff: captureOff || undefined,
      confirmedAt,
      clientConfirmedAt: new Date().toISOString(),
      clockOffsetMs: serverOffset.current,
    };
    const item: TouchOutboxItem = {
      id: `${api.workspaceId}:${sale.operationId}`,
      workspaceId: api.workspaceId,
      sale,
      createdAt: Date.now(),
    };
    try {
      await touchLocalStore.putOutbox(item);
      await reloadOutbox();
      const next = [
        inputPrice,
        ...recent.filter((p) => p !== inputPrice),
      ].slice(0, 3);
      setRecent(next);
      localStorage.setItem(
        `voicecap-touch-recent:${workspaceId}`,
        JSON.stringify(next),
      );
      const request = api.commit(sale);
      let timeout: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        request,
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => resolve(null), 3000);
        }),
      ]).finally(() => clearTimeout(timeout!));
      if (result) {
        await touchLocalStore.removeOutbox(item.id);
        navigator.vibrate?.(70);
        const seconds = Math.max(
          0,
          Math.round(
            (Date.parse(result.captureDueAt) -
              Date.now() -
              serverOffset.current) /
              1000,
          ),
        );
        setNotice(
          `${priceComment.nickname} ${result.amount.toLocaleString()}원 저장 · 전표 출력 중${captureOff ? '' : ` · ${seconds}초 뒤 캡처`}`,
        );
        setRecentSale({ saleIds: [result.saleId], label: '' });
        await refresh();
      } else {
        setNotice('저장 확인 중 · 같은 작업 번호로 확인합니다.');
        void request
          .then(async (late) => {
            if (mounted.current)
              setRecentSale({ saleIds: [late.saleId], label: '' });
            await touchLocalStore.removeOutbox(item.id);
            await reloadOutbox();
            await refresh();
          })
          .catch(() => {});
      }
      setPriceComment(null);
      setSelection((s) => ({ ...s, selectedKey: null }));
      await reloadOutbox();
    } catch (e) {
      const failure = classifyTouchSaveFailure(e);
      await touchLocalStore.putOutbox({
        ...item,
        error: failure.detail || failure.message,
        code: failure.code,
        blocked: failure.blocked,
      });
      await reloadOutbox();
      if (failure.blocked) setError(failure.message);
      else {
        setNotice(failure.kind === 'NETWORK' ? failure.message : '');
        setPriceComment(null);
        setSelection((s) => ({ ...s, selectedKey: null }));
      }
    } finally {
      submission.current = false;
      setBusy(false);
    }
  };
  /** 상품번호·사이즈·색상 방식: 고른 고객마다 판매 1건·전표 1장, 같은 시각·같은 가격. */
  const submitBatch = async (
    chosen: TouchComment[],
    number: number,
    inputPrice: string,
    unitPrice: number,
    quantity: number,
    reuseProductPhoto: boolean,
  ) => {
    if (submission.current || !chosen.length || !sessionId) return;
    const pending = chosen.find((c) =>
      outbox.some(
        (i) =>
          i.sale.comment.platformMessageId === (c.platformMessageId || c.id),
      ),
    );
    if (pending) {
      setNotice(
        `${pending.nickname} 댓글의 저장 요청이 이미 있습니다. 판매내역을 확인해 주세요.`,
      );
      return;
    }
    submission.current = true;
    setBusy(true);
    setError('');
    const label = touchProductLabel(number);
    const confirmedAt = new Date(
      Date.now() + serverOffset.current,
    ).toISOString();
    const items: TouchOutboxItem[] = chosen.map((c) => {
      const sale: TouchCommit = {
        operationId: crypto.randomUUID(),
        sessionId,
        comment: {
          platformMessageId: c.platformMessageId || c.id,
          platformUserId: c.platformUserId,
          uniqueId: c.uniqueId,
          nickname: c.nickname,
          content: c.content,
          capturedAt: c.capturedAt,
        },
        inputPrice,
        unitPrice,
        quantity,
        productLabel: label,
        slipLine: touchSlipLine(salesMode, number, c.content),
        captureOff: captureOff || undefined,
        reuseProductPhoto: reuseProductPhoto || undefined,
        allowAdditional: sold.has(touchCommentKey(c)) || undefined,
        confirmedAt,
        clientConfirmedAt: new Date().toISOString(),
        clockOffsetMs: serverOffset.current,
      };
      return {
        id: `${api.workspaceId}:${sale.operationId}`,
        workspaceId: api.workspaceId,
        sale,
        createdAt: Date.now(),
      };
    });
    const saved: string[] = [];
    let failed = 0,
      blockedMessage = '';
    try {
      for (const item of items) await touchLocalStore.putOutbox(item);
      await reloadOutbox();
      const next = [
        inputPrice,
        ...recent.filter((p) => p !== inputPrice),
      ].slice(0, 3);
      setRecent(next);
      localStorage.setItem(
        `voicecap-touch-recent:${workspaceId}`,
        JSON.stringify(next),
      );
      for (const item of items) {
        try {
          const result = await api.commit(item.sale);
          await touchLocalStore.removeOutbox(item.id);
          saved.push(result.saleId);
        } catch (e) {
          const failure = classifyTouchSaveFailure(e);
          failed++;
          if (failure.blocked) blockedMessage = failure.message;
          await touchLocalStore.putOutbox({
            ...item,
            error: failure.detail || failure.message,
            code: failure.code,
            blocked: failure.blocked,
          });
        }
      }
      await reloadOutbox();
      if (saved.length) {
        navigator.vibrate?.(70);
        setRecentSale({ saleIds: saved, label });
      }
      setNotice(
        `${label} · ${saved.length}명 저장${saved.length ? ' · 전표 출력 중' : ''}${failed ? ` · ${failed}건 저장 대기 · 판매내역에서 확인` : ''}`,
      );
      if (blockedMessage) setError(blockedMessage);
      setPicked([]);
      setBatch(null);
      if (reuseProductPhoto) {
        setCurrentNumber(returnNumber ?? number);
        setReturnNumber(null);
      } else {
        const following = nextUnsoldNumber(
          number,
          new Set([...soldNumbers, number]),
        );
        // 카운트다운 동안은 지금 번호를 그대로 보여 준다.
        const wait = captureOff ? 0 : (runSettings?.prepareSeconds || 4) * 1000;
        setTimeout(() => {
          if (mounted.current)
            setCurrentNumber((n) => (n === number ? following : n));
        }, wait);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submission.current = false;
      setBusy(false);
    }
  };
  const confirmBatch = (priceChange: boolean) => {
    if (!picked.length) return;
    const people = picked.map(
      (c) => c.platformUserId || c.uniqueId || c.nickname,
    );
    if (
      new Set(people).size !== people.length &&
      !confirm('같은 고객의 댓글을 2개 이상 골랐습니다. 그대로 판매할까요?')
    )
      return;
    const info = numberInfo.get(currentNumber);
    if (info && !priceChange) {
      void submitBatch(
        picked,
        currentNumber,
        String(info.unitPrice),
        info.unitPrice,
        1,
        true,
      );
      return;
    }
    setError('');
    setBatch({ comments: picked, number: currentNumber, priceChange: !!info });
  };
  const recentRows = recentSale
    ? recentSale.saleIds
        .map((id) => rows.find((s) => s.id === id))
        .filter(
          (s): s is TouchSale =>
            !!s && s.recordState !== 'CANCELLED' && s.status !== '취소',
        )
    : [];
  const updateRecent = async (
    kind: 'PRICE' | 'CANCEL',
    price?: { inputPrice: string; unitPrice: number },
  ) => {
    if (busy || !recentRows.length) return;
    setBusy(true);
    setError('');
    try {
      for (const row of recentRows)
        await api.update({
          kind,
          saleId: row.id,
          expectedRevision: row.revision,
          ...(price || {}),
          reprint: kind === 'PRICE' ? true : undefined,
        });
      setCardPrice(false);
      if (kind === 'CANCEL') setRecentSale(null);
      setNotice(
        kind === 'CANCEL'
          ? `${recentRows.length}건을 취소했습니다.`
          : '가격을 고치고 수정 전표를 출력합니다.',
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const retakeRecent = async () => {
    if (busy || !recentRows.length) return;
    setBusy(true);
    setError('');
    try {
      for (const row of recentRows) await api.resetCapture(row.id);
      if (transport === 'DIRECT' && recentRows[0])
        pipe.current?.send({
          kind: 'get-candidates',
          saleId: recentRows[0].id,
        });
      setNotice('상품을 다시 보여 주세요. 다시 찍습니다.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const update = async (patch: Parameters<TouchSalesApi['update']>[0]) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (['PRICE', 'BUYER', 'CANCEL'].includes(patch.kind)) {
        const meta = await api.detail(patch.saleId);
        setDetailMeta(meta);
        if (
          meta.settlementUsed &&
          !confirm(
            '정산서 또는 입금 대조에 사용한 판매입니다. 수정 후 정산 내역도 확인해 주세요. 계속할까요?',
          )
        )
          return;
      }
      await api.update(patch);
      await refresh();
      setEditPrice(false);
      setBuyers(null);
      setNotice('판매내역을 수정했습니다.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // 폰 단독 판매: 이 폰(또는 다른 폰)이 판매 연결의 주인이다. PC 연결 표시는 쓰지 않는다.
  const phoneOnlyRun =
    phoneRunning ||
    (!!bootstrap?.run?.running && bootstrap.run.last_state?.phoneOnly === true);
  const phoneOnlyUi = salesApp || phoneOnlyRun;
  const bridgeOnline =
    !!pipe.current &&
    Date.now() - pipe.current.lastReceivedAt <
      (transport === 'DIRECT' ? 5000 : 12000);
  const onlinePc = phoneOnlyRun || bridgeOnline;
  // 같은 keyed 자식으로 모든 판매 화면에 남겨 둔다. 가격 입력·상세 화면으로
  // 바뀔 때 해제하면 TouchPhoneOnly의 정리 함수가 실제 판매 연결을 멈춘다.
  const phoneController = (
    <TouchPhoneOnly
      key={`phone-producer:${api.workspaceId}`}
      api={api}
      bootstrap={bootstrap}
      refresh={refresh}
      serverOffset={() => serverOffset.current}
      totals={() => phoneTotals.current}
      onComments={(items) =>
        setComments((old) =>
          mergeTouchComments(old, items, items[0]?.sessionId || ''),
        )
      }
      onRunningChange={setPhoneRunning}
      pcOnline={bridgeOnline && !phoneRunning}
      wakeKey={bootstrap}
      controlsVisible={
        !((editPrice && detail) || (cardPrice && recentRows[0]) || batch || priceComment || detail)
      }
    />
  );
  phoneTotals.current = { totalCount: activeRows.length, totalAmount: total };
  const sessionName =
    bootstrap?.session?.display_code || pc?.displayCode || '회차 대기';
  const compactSession = sessionName.replace(
    /\d{4}-(\d{2})-(\d{2}) 라이브 /,
    '$1/$2 ',
  );
  const renderOutbox = () =>
    outbox.map((item) => (
      <div className="touch-outbox" key={item.id}>
        <strong>
          {item.blocked ? '확인 필요' : '↻ 보내는 중'} ·{' '}
          {item.sale.comment.nickname}{' '}
          {(item.sale.unitPrice * item.sale.quantity).toLocaleString()}원
        </strong>
        <p>
          {item.code === 'TOUCH_NOT_RUNNING'
            ? '판매 연결이 멈춰 저장되지 않았습니다. 판매를 다시 시작한 뒤 저장해 주세요.'
            : item.error
              ? classifyTouchSaveFailure({ code: item.code, message: item.error }).message
              : '판매 저장을 확인하고 있습니다. 전표와 캡처는 저장 확인 후 진행합니다.'}
        </p>
        {item.code === 'COMMENT_ALREADY_COMMITTED' && (
          <button
            onClick={() => {
              void touchLocalStore
                .putOutbox({
                  ...item,
                  blocked: false,
                  code: undefined,
                  error: undefined,
                  sale: { ...item.sale, allowAdditional: true },
                })
                .then(() => flush());
            }}
          >
            추가 판매로 저장
          </button>
        )}
        {item.code === 'TOUCH_NOT_RUNNING' &&
          item.sale.sessionId === sessionId &&
          enabled && (
            <button
              disabled={busy}
              onClick={() => {
                // 같은 회차의 같은 작업을 다시 보낸다. 확정 시각·촬영 기준도 유지한다.
                void touchLocalStore
                  .putOutbox({
                    ...item,
                    blocked: false,
                    code: undefined,
                    error: undefined,
                  })
                  .then(() => flush());
              }}
            >
              판매 연결 후 다시 저장
            </button>
          )}
        {item.code === 'SESSION_ENDED' &&
          sessionId !== item.sale.sessionId &&
          enabled && (
            <button
              onClick={() => {
                if (
                  confirm(
                    '현재 회차에 이 판매를 새로 저장할까요? 이전 캡처 시각은 지났을 수 있습니다.',
                  )
                ) {
                  const operationId = crypto.randomUUID();
                  void touchLocalStore
                    .putOutbox({
                      ...item,
                      id: `${api.workspaceId}:${operationId}`,
                      blocked: false,
                      code: undefined,
                      error: undefined,
                      sale: {
                        ...item.sale,
                        operationId,
                        sessionId,
                        productId: undefined,
                        confirmedAt: new Date(
                          Date.now() + serverOffset.current,
                        ).toISOString(),
                        clientConfirmedAt: new Date().toISOString(),
                        originalConfirmedAt:
                          item.sale.originalConfirmedAt ||
                          item.sale.confirmedAt,
                        retargetedFromOperationId: item.sale.operationId,
                        skipCapture: true,
                      },
                    })
                    .then(() => touchLocalStore.removeOutbox(item.id))
                    .then(() => flush());
                }
              }}
            >
              현재 회차에 다시 저장 · 사진은 재촬영
            </button>
          )}
        {item.blocked && (
          <button
            onClick={() => {
              if (confirm('서버에 저장되지 않은 이 요청을 지울까요?'))
                void touchLocalStore
                  .removeOutbox(item.id)
                  .then(() => reloadOutbox());
            }}
          >
            요청 지우기
          </button>
        )}
      </div>
    ));
  if (editPrice && detail)
    return (
      <div className="touch-app">
        {phoneController}
        <TouchPricePad
          phoneOnly={phoneOnlyUi}
          key={detail.id}
          title="가격 수정"
          comment={{
            ...detail.comment,
            id: detail.id,
            sessionId: detail.sessionId,
            sequence: 0,
          }}
          recent={recent}
          busy={busy}
          error={error}
          onCancel={() => setEditPrice(false)}
          onSubmit={(inputPrice, unitPrice) =>
            void update({
              kind: 'PRICE',
              saleId: detail.id,
              expectedRevision: detail.revision,
              inputPrice,
              unitPrice,
              reprint,
            })
          }
        />
        <label className="touch-reprint-option">
          <input
            type="checkbox"
            checked={reprint}
            onChange={(e) => setReprint(e.target.checked)}
          />{' '}
          수정 전표 출력
        </label>
      </div>
    );
  if (cardPrice && recentRows[0])
    return (
      <div className="touch-app">
        {phoneController}
        <TouchPricePad
          phoneOnly={phoneOnlyUi}
          key={`card-${recentRows[0].id}`}
          title="방금 판매 가격 수정"
          comment={{
            ...recentRows[0].comment,
            nickname:
              recentRows.length > 1
                ? `${recentRows[0].buyerNickname} 외 ${recentRows.length - 1}명`
                : recentRows[0].buyerNickname,
            id: recentRows[0].id,
            sessionId: recentRows[0].sessionId,
            sequence: 0,
          }}
          productName={recentSale?.label || recentRows[0].productName}
          recent={recent}
          busy={busy}
          error={error}
          onCancel={() => setCardPrice(false)}
          onSubmit={(inputPrice, unitPrice) =>
            void updateRecent('PRICE', { inputPrice, unitPrice })
          }
        />
      </div>
    );
  if (batch)
    return (
      <div className="touch-app">
        {phoneController}
        <TouchPricePad
          phoneOnly={phoneOnlyUi}
          key={`batch-${batch.number}-${batch.comments.length}`}
          title={
            batch.priceChange
              ? `${touchProductLabel(batch.number)} 가격 바꾸기`
              : '가격 입력'
          }
          comment={{
            ...batch.comments[0],
            nickname:
              batch.comments.length > 1
                ? `${batch.comments[0].nickname} 외 ${batch.comments.length - 1}명`
                : batch.comments[0].nickname,
          }}
          productName={`${touchProductLabel(batch.number)} · ${batch.comments.length}명${batch.priceChange ? ' · 캡처 없이 전표만' : ''}`}
          recent={recent}
          busy={busy}
          error={error}
          onCancel={() => {
            setBatch(null);
            setError('');
          }}
          onSubmit={(input, price, quantity) =>
            void submitBatch(
              batch.comments,
              batch.number,
              input,
              price,
              quantity,
              batch.priceChange,
            )
          }
        />
      </div>
    );
  if (priceComment)
    return (
      <div className="touch-app">
        {phoneController}
        <TouchPricePad
          phoneOnly={phoneOnlyUi}
          key={touchCommentKey(priceComment)}
          comment={priceComment}
          productName={pc?.product?.name || undefined}
          recent={recent}
          busy={busy}
          error={error}
          onCancel={() => {
            setPriceComment(null);
            setError('');
          }}
          onSubmit={(input, price, quantity) =>
            void submit(input, price, quantity)
          }
        />
      </div>
    );
  if (detail)
    return (
      <div className="touch-app">
        {phoneController}
        <header className="touch-detail-header">
          <button
            aria-label="판매내역으로 돌아가기"
            onClick={() => setDetailId(null)}
          >
            ‹
          </button>
          <h1>판매 상세</h1>
          <small>
            {detail.status} ·{' '}
            {detail.source === 'WEB_VOICE'
              ? '음성'
              : detail.source === 'MANUAL'
                ? '수동'
                : '앱'}
          </small>
        </header>
        <div className="touch-detail-content">
          <section className="touch-detail-hero">
            <div>
              {detail.imageUrl ? (
                <img src={detail.imageUrl} alt="판매 상품 사진" />
              ) : (
                <span>
                  상품 사진{' '}
                  {detail.captureStatus === 'PENDING' ? '대기' : '없음'}
                </span>
              )}
            </div>
            <article>
              <h2>{detail.buyerNickname}</h2>
              <strong>{detail.amount.toLocaleString()}원</strong>
              <p>
                {detail.quantity}개 · {detail.productName || '상품명 없음'}
              </p>
              <p>
                {new Date(detail.recognizedAt).toLocaleTimeString('ko-KR')} 확정
              </p>
              <small>{printLabel(detail.printStatus)}</small>
            </article>
          </section>
          {!phoneOnlyUi && (
            <section className="touch-detail-section">
              <h3>다른 장면</h3>
              <p className="touch-muted">PC에 24시간 보관 · 판매 사진은 1장</p>
              <button
                onClick={() => {
                  pipe.current?.send({
                    kind: 'get-candidates',
                    saleId: detail.id,
                  });
                  if (transport !== 'DIRECT')
                    setNotice('예비 연결 중에는 PC에서 다른 장면을 골라 주세요.');
                }}
              >
                2초 전·기준·2초 후 보기
              </button>
            </section>
          )}
          <section className="touch-detail-section">
            <h3>근거 댓글</h3>
            <strong>{detail.comment?.nickname || detail.buyerNickname}</strong>
            <p>
              {detail.comment?.content ||
                (phoneOnlyUi
                  ? '등록된 근거 댓글이 없습니다.'
                  : 'PC에서 등록한 판매입니다.')}
            </p>
          </section>
          {!!detailMeta?.history.length && (
            <section className="touch-detail-section">
              <h3>수정 이력</h3>
              {detailMeta.history.map((h, i) => (
                <p key={i}>
                  <strong>{h.reason}</strong> ·{' '}
                  {new Date(h.created_at).toLocaleString('ko-KR')}
                  <br />
                  {h.before_value?.buyer_nickname}{' '}
                  {Number(h.before_value?.amount || 0).toLocaleString()}원 →{' '}
                  {h.after_value?.buyer_nickname}{' '}
                  {Number(h.after_value?.amount || 0).toLocaleString()}원 ·{' '}
                  {h.after_value?.status}
                </p>
              ))}
            </section>
          )}
          <div className="touch-detail-actions">
            <button
              disabled={busy || !detail.comment}
              onClick={() => {
                setReprint(true);
                setError('');
                setEditPrice(true);
              }}
            >
              가격 수정
            </button>
            <button
              disabled={busy || !detail.comment}
              onClick={() => {
                setBuyers([]);
                setBuyerSearch('');
              }}
            >
              구매자 변경
            </button>
            <button
              disabled={busy || !detail.comment}
              onClick={() => {
                if (
                  confirm(
                    '전표를 다시 출력할까요? 출력 여부가 불확실한 경우 종이를 먼저 확인하세요.',
                  )
                )
                  void update({
                    kind: 'REPRINT',
                    saleId: detail.id,
                    expectedRevision: detail.revision,
                  });
              }}
            >
              전표 다시 출력
            </button>
            <button
              disabled={busy || !detail.comment}
              onClick={() => {
                void api
                  .resetCapture(detail.id)
                  .then(() => {
                    setNotice(
                      phoneOnlyUi
                        ? '상품을 다시 보여주세요. 폰에서 카운트다운 뒤 촬영합니다.'
                        : '상품을 다시 보여주세요. PC가 방송 지연을 보정해 촬영합니다.',
                    );
                    return refresh();
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              캡처 다시 찍기
            </button>
            <button
              disabled={busy || !detail.comment || detail.status === '취소'}
              className="touch-danger"
              onClick={() => {
                if (
                  confirm(
                    `${detail.buyerNickname} ${detail.amount.toLocaleString()}원 판매를 삭제할까요? 기록은 취소 상태로 남습니다. 정산에 사용한 판매라면 정산도 확인해 주세요.`,
                  )
                )
                  void update({
                    kind: 'CANCEL',
                    saleId: detail.id,
                    expectedRevision: detail.revision,
                  });
              }}
            >
              삭제
            </button>
          </div>
          {(error || pendingSaveError) && (
            <p role="alert" className="touch-error">
              {error || pendingSaveError}
            </p>
          )}
        </div>
        {renderOverlay()}
      </div>
    );
  function renderOverlay() {
    return (
      <>
        {notice && (
          <div role="status" className="touch-toast">
            ✓ {notice}
          </div>
        )}
        {candidates && (
          <div
            className="touch-modal-backdrop"
            role="dialog"
            aria-label="예비 장면 선택"
          >
            <section className="touch-modal">
              <h2>판매 사진을 고르세요</h2>
              <div className="touch-frame-options">
                {candidates.frames.map((frame, i) => (
                  <button
                    key={frame.at}
                    onClick={() => {
                      pipe.current?.send({
                        kind: 'choose-frame',
                        saleId: candidates.saleId,
                        index: i,
                      });
                    }}
                  >
                    <img src={frame.image} alt={`예비 장면 ${i + 1}`} />
                    <small>
                      {new Date(frame.at).toLocaleTimeString('ko-KR')}
                    </small>
                  </button>
                ))}
              </div>
              {!candidates.frames.length && (
                <p>예비 장면이 없습니다. 다시 촬영해 주세요.</p>
              )}
              <button onClick={() => setCandidates(null)}>닫기</button>
            </section>
          </div>
        )}
        {buyers && (
          <div
            className="touch-modal-backdrop"
            role="dialog"
            aria-label="구매자 변경"
          >
            <section className="touch-modal">
              <h2>구매자 변경</h2>
              <input
                aria-label="구매자 이름 검색"
                placeholder="닉네임 검색"
                value={buyerSearch}
                onChange={(e) => setBuyerSearch(e.target.value)}
              />
              <button
                onClick={() =>
                  void productSalesApi
                    .searchBuyers(buyerSearch)
                    .then((result) => setBuyers(result.buyers))
                    .catch((e) => setError(e.message))
                }
              >
                검색
              </button>
              {buyers.map((b) => (
                <button
                  className="touch-buyer-option"
                  key={b.id}
                  onClick={() => {
                    if (
                      detail &&
                      confirm(
                        `${b.displayNickname} 고객으로 변경하고 수정 전표를 출력할까요?`,
                      )
                    )
                      void update({
                        kind: 'BUYER',
                        saleId: detail.id,
                        expectedRevision: detail.revision,
                        buyerId: b.id,
                        reprint: true,
                      });
                  }}
                >
                  {b.displayNickname} @
                  {b.platformUniqueId || b.platformUserId || ''}
                </button>
              ))}
              <button onClick={() => setBuyers(null)}>닫기</button>
            </section>
          </div>
        )}
      </>
    );
  }
  const recentCard = recentRows.length ? (
    <TouchRecentSaleCard
      rows={recentRows}
      label={recentSale?.label || ''}
      captureOff={captureOff}
      busy={busy}
      now={Date.now() + serverOffset.current}
      onRetake={() => void retakeRecent()}
      onPrice={() => {
        setError('');
        setCardPrice(true);
      }}
      onCancel={() => {
        if (
          confirm(
            recentRows.length > 1
              ? `방금 판매 ${recentRows.length}건을 모두 취소할까요? 한 명만 취소하려면 판매내역에서 고르세요.`
              : `${recentRows[0].buyerNickname} ${recentRows[0].amount.toLocaleString()}원 판매를 취소할까요?`,
          )
        )
          void updateRecent('CANCEL');
      }}
    />
  ) : null;
  const currentLabel = touchProductLabel(currentNumber),
    currentSoldPrice = numberInfo.get(currentNumber)?.unitPrice;
  const multiFooter = (
    <footer className="touch-selection-bar">
      <p>
        {picked.length ? (
          <>
            <strong>
              {currentLabel} · {picked.length}명
            </strong>{' '}
            · {picked.map((c) => c.nickname).join(', ')}
          </>
        ) : (
          <>
            🟡 {salesMode === 'NUMBER' ? `${currentLabel} 댓글` : '구매 댓글'}을
            눌러 구매자를 고르세요 · 여러 명 가능
          </>
        )}
      </p>
      <div>
        <button
          type="button"
          onClick={() => setPicked([])}
          disabled={!picked.length}
        >
          취소
        </button>
        <button
          type="button"
          className="touch-primary"
          onClick={() => confirmBatch(false)}
          disabled={!picked.length || !enabled || busy}
        >
          {currentSoldPrice ? '전표만 출력' : '판매 확정'}
        </button>
      </div>
      {!!currentSoldPrice && !!picked.length && (
        <button
          type="button"
          className="touch-price-change"
          disabled={!enabled || busy}
          onClick={() => confirmBatch(true)}
        >
          가격 바꾸기
        </button>
      )}
    </footer>
  );
  return (
    <div className="touch-app">
      <nav className="touch-top-tabs" aria-label="VoiceCAP 판매">
        <button
          className={tab === 'HISTORY' ? 'active' : ''}
          onClick={() => {
            setTab('HISTORY');
            void refresh();
          }}
        >
          판매내역
        </button>
        <button
          className={tab === 'SELL' ? 'active' : ''}
          onClick={() => setTab('SELL')}
        >
          판매하기
        </button>
        <button
          className="touch-account-button"
          aria-label="계정 보기"
          onClick={() => {
            setLogoutConfirm(false);
            setAccountOpen(true);
          }}
        >
          계정
        </button>
      </nav>
      <div
        className={`touch-status-line ${!phoneOnlyUi && !onlinePc ? 'touch-status-offline' : ''}`}
      >
        <strong>{compactSession}</strong>
        {phoneOnlyUi ? (
          <span>{phoneOnlyRun ? '폰 단독 판매' : '폰 판매 대기'}</span>
        ) : (
          <>
            <span>
              댓글 ●{' '}
              {transport === 'DIRECT'
                ? '직접'
                : transport === 'FALLBACK'
                  ? '예비'
                  : '연결 중'}
            </span>
            <span>PC ● {onlinePc ? '연결' : '끊김'}</span>
          </>
        )}
        <strong>
          {activeRows.length}건 / {total.toLocaleString()}원
        </strong>
      </div>
      {phoneController}
      {!enabled && !phoneRunning && (
        <p className="touch-waiting">
          {phoneOnlyUi
            ? '위의 폰으로 판매 시작을 눌러 주세요.'
            : 'PC 라이브 청취 홈에서 댓글터치 · 판매 시작을 누르거나, 위의 폰으로 판매 시작을 눌러 주세요.'}
        </p>
      )}
      {!phoneOnlyUi && !onlinePc && enabled && (
        <p className="touch-waiting">
          PC 연결 끊김 · 새 댓글과 전표 대기. 이미 받은 댓글의 판매는 저장할 수
          있습니다.
        </p>
      )}
      {(error || pendingSaveError) && (
        <p role="alert" className="touch-error touch-page-error">
          {error || pendingSaveError}
        </p>
      )}
      {tab === 'SELL' ? (
        <>
          {!phoneOnlyUi && (
            <div className="touch-audio-hint">
              <button
                onClick={() => {
                  setMicEnabled((v) => !v);
                  setMicStatus(
                    micEnabled ? '설정값으로 촬영' : '마이크 허용 후 지연 측정',
                  );
                }}
              >
                {micEnabled ? '지연 측정 끄기' : '마이크로 지연 측정'}
              </button>
              <small>
                {transport !== 'DIRECT'
                  ? '예비 연결에서는 설정값 사용'
                  : micStatus || '녹음·음성 전송 없음'}
              </small>
            </div>
          )}
          {multi && (
            <TouchNumberBar
              number={currentNumber}
              soldPrice={numberInfo.get(currentNumber)?.unitPrice}
              disabled={busy}
              onChange={changeNumber}
            />
          )}
          <TouchCommentList
            comments={displayComments}
            emptyMessage={
              phoneOnlyUi
                ? phoneOnlyRun
                  ? '새 댓글을 기다리고 있습니다.'
                  : '폰으로 판매를 시작하면 실시간 댓글이 이곳에 표시됩니다.'
                : undefined
            }
            selection={selection}
            selectedComment={selectedSnapshot}
            sold={sold}
            enabled={enabled}
            mode={salesMode}
            currentNumber={currentNumber}
            picked={multi ? picked.map(touchCommentKey) : undefined}
            idleFooter={recentCard}
            footer={
              multi
                ? picked.length || !recentCard
                  ? multiFooter
                  : recentCard
                : undefined
            }
            onOpenSold={(key) => {
              const row = rows.find(
                (s) =>
                  s.comment?.platformMessageId &&
                  `${s.sessionId}:${s.comment.platformMessageId}` === key,
              );
              if (row) setDetailId(row.id);
            }}
            onSearch={searchArchive}
            onSelect={(c) => {
              if (multi) {
                const key = touchCommentKey(c);
                setPicked((old) =>
                  old.some((p) => touchCommentKey(p) === key)
                    ? old.filter((p) => touchCommentKey(p) !== key)
                    : [...old, c],
                );
                return;
              }
              setSelectedSnapshot(c);
              setSelection((s) =>
                selectTouchComment(
                  s,
                  c,
                  [...comments, ...archiveRows],
                  new Set(sold.keys()),
                ),
              );
            }}
            onCancel={() => {
              setSelectedSnapshot(null);
              setSelection((s) => ({ ...s, selectedKey: null }));
            }}
            onConfirm={() => {
              if (selected) {
                setError('');
                setPriceComment(selected);
              }
            }}
          />
        </>
      ) : (
        <section className="touch-history">
          <div className="touch-history-heading">
            <div>
              <small>{compactSession}</small>
              <h1>
                {activeRows.length}건 · {total.toLocaleString()}원
              </h1>
              <p className="touch-muted">
                {outbox.length
                  ? `보내는 중 ${outbox.length}건 별도`
                  : '이번 회차 판매내역'}
              </p>
            </div>
            <div>
              <button
                className={!grouped ? 'active' : ''}
                onClick={() => setGrouped(false)}
              >
                건별
              </button>
              <button
                className={grouped ? 'active' : ''}
                onClick={() => setGrouped(true)}
              >
                구매자별
              </button>
            </div>
          </div>
          {renderOutbox()}
          {!rows.length && (
            <p className="touch-empty">아직 판매내역이 없습니다.</p>
          )}
          {grouped
            ? [
                ...new Set(activeRows.map((s) => s.buyerId || s.buyerNickname)),
              ].map((key) => {
                const group = activeRows.filter(
                  (s) => (s.buyerId || s.buyerNickname) === key,
                );
                return (
                  <button
                    key={key}
                    className="touch-sale-row"
                    onClick={() => setDetailId(group[0].id)}
                  >
                    <strong>
                      {group[0].buyerNickname} · {group.length}건
                    </strong>
                    <strong>
                      {group.reduce((n, s) => n + s.amount, 0).toLocaleString()}
                      원
                    </strong>
                  </button>
                );
              })
            : rows.map((sale, index) => (
                <button
                  className={`touch-sale-row ${sale.status === '취소' ? 'touch-sale-cancelled' : ''}`}
                  key={sale.id}
                  onClick={() => setDetailId(sale.id)}
                >
                  <div>
                    <strong>
                      {String(rows.length - index).padStart(3, '0')}{' '}
                      {sale.buyerNickname} {sale.amount.toLocaleString()}원
                    </strong>
                    <p>
                      <small
                        className={
                          sale.printStatus === 'FAILED'
                            ? 'touch-print-error'
                            : 'touch-print-status'
                        }
                      >
                        {printLabel(sale.printStatus)}
                      </small>
                      {sale.captureStatus === 'PENDING' && (
                        <small className="touch-capture-pending">
                          캡처{' '}
                          {Math.max(
                            0,
                            Math.ceil(
                              (Date.parse(sale.captureDueAt) -
                                Date.now() -
                                serverOffset.current) /
                                1000,
                            ),
                          )}
                          초 뒤
                        </small>
                      )}
                      {sale.status === '취소' && <small>취소됨</small>}
                      {sale.productName &&
                        touchLabelNumber(sale.productName) !== null && (
                          <small className="touch-number-badge">
                            {sale.productName}
                          </small>
                        )}
                    </p>
                  </div>
                  <time>
                    {new Date(sale.recognizedAt).toLocaleTimeString('ko-KR', {
                      hour12: false,
                    })}
                  </time>
                  {sale.imageUrl ? (
                    <img src={sale.imageUrl} alt="상품 사진" />
                  ) : (
                    <span className="touch-image-placeholder">
                      {sale.captureStatus === 'PENDING'
                        ? '대기'
                        : sale.captureStatus === 'SKIPPED'
                          ? '캡처 안 함'
                          : '없음'}
                    </span>
                  )}
                </button>
              ))}
        </section>
      )}
      {accountOpen && (
        <div className="touch-modal-backdrop" role="dialog" aria-label="계정">
          <section className="touch-modal">
            <h2>{user?.nickname || '판매자'}</h2>
            <p className="touch-account-email">{user?.email}</p>
            {logoutConfirm && (
              <p className="touch-account-warning">
                {touchLogoutWarning(outbox.length)}
              </p>
            )}
            {logoutConfirm ? (
              <>
                <button
                  className="touch-account-logout"
                  onClick={() => void logout()}
                >
                  로그아웃 확인
                </button>
                <button onClick={() => setLogoutConfirm(false)}>취소</button>
              </>
            ) : (
              <>
                <button
                  className="touch-account-logout"
                  onClick={() => setLogoutConfirm(true)}
                >
                  로그아웃
                </button>
                <button onClick={() => setAccountOpen(false)}>닫기</button>
              </>
            )}
          </section>
        </div>
      )}
      {renderOverlay()}
    </div>
  );
}
