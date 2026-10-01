import React, { useEffect, useRef, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { useLive } from '../../context/LiveContext';
import { useListeningStopSchedule } from '../../context/ListeningStopScheduleContext';
import {
  formatListeningStopCountdown, MAX_LISTENING_STOP_DELAY_MS, resolveListeningStopAt, toLocalDateTimeInput,
} from '../../services/listeningStopScheduleService';

const formatEndTime = (timestamp: number) => new Date(timestamp).toLocaleString('ko-KR', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export const ListeningStopControl: React.FC = () => {
  const { isListening } = useLive();
  const { scheduledStop, scheduleStop, cancelScheduledStop } = useListeningStopSchedule();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'DURATION' | 'AT_TIME'>('DURATION');
  const [minutes, setMinutes] = useState('60');
  const [datetime, setDatetime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (!isListening) setIsOpen(false); }, [isListening]);
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('button, input')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setIsOpen(false); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); triggerRef.current?.focus(); };
  }, [isOpen]);

  const openDialog = () => {
    setMode(scheduledStop ? 'AT_TIME' : 'DURATION');
    setDatetime(toLocalDateTimeInput(scheduledStop?.endsAt || Date.now() + 60 * 60_000));
    setMinutes('60');
    setError(null);
    setIsOpen(true);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      scheduleStop(resolveListeningStopAt(mode === 'DURATION' ? { mode, minutes } : { mode, datetime }));
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '종료 예약을 설정하지 못했습니다.');
    }
  };

  return <>
    <button type="button" ref={triggerRef} onClick={openDialog} disabled={!isListening}
      aria-label={scheduledStop ? '종료 예약 변경' : '종료 예약'}
      title={isListening ? '청취와 댓글 캡처를 중지할 시간 예약' : '청취를 시작한 후 종료 예약을 설정하세요'}
      className={`h-8 px-2 rounded-lg text-[11px] font-bold border flex items-center justify-center gap-1 transition disabled:opacity-40 disabled:cursor-not-allowed ${
        scheduledStop ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
      }`}>
      <Clock className="w-3.5 h-3.5" /><span className="hidden sm:inline">{scheduledStop ? '예약 변경' : '종료 예약'}</span>
    </button>
    {isOpen && isListening && <div className="fixed inset-0 z-[75] bg-slate-950/60 flex items-center justify-center p-4"
      onClick={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="listening-stop-title"
        className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-3xl border border-slate-200 shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="listening-stop-title" className="text-lg font-black text-slate-900">라이브 청취 종료 예약</h2>
          <button type="button" onClick={() => setIsOpen(false)} aria-label="종료 예약 창 닫기" className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">예약 시간이 되면 음성 청취와 댓글 캡처를 함께 중지합니다. 판매·댓글 기록은 삭제하지 않습니다.</p>
        {scheduledStop && <p className="text-sm font-bold text-amber-800 bg-amber-50 rounded-xl p-3">현재 예약: {formatEndTime(scheduledStop.endsAt)} 종료</p>}
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="flex gap-2">
            <legend className="sr-only">종료 예약 방식</legend>
            {(['DURATION', 'AT_TIME'] as const).map((value) => <label key={value}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-bold cursor-pointer ${mode === value ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}>
              <input type="radio" name="listening-stop-mode" checked={mode === value} onChange={() => { setMode(value); setError(null); }} />
              {value === 'DURATION' ? '몇 분 후 종료' : '시각 지정'}
            </label>)}
          </fieldset>
          {mode === 'DURATION' ? <div className="space-y-3">
            <div className="flex gap-2">{[30, 60, 120].map((value) => <button key={value} type="button" onClick={() => setMinutes(String(value))}
              className={`flex-1 rounded-lg border py-2 text-sm font-bold ${minutes === String(value) ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}>{value}분</button>)}</div>
            <label className="block text-sm font-bold text-slate-700">종료까지 남은 시간 (분)
              <input type="number" min="1" max="1440" step="1" required value={minutes}
                onChange={(event) => { setMinutes(event.target.value); setError(null); }}
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base" />
            </label>
          </div> : <label className="block text-sm font-bold text-slate-700">종료 날짜와 시각
            <input type="datetime-local" required value={datetime} min={toLocalDateTimeInput(Date.now())}
              max={toLocalDateTimeInput(Date.now() + MAX_LISTENING_STOP_DELAY_MS)}
              onChange={(event) => { setDatetime(event.target.value); setError(null); }}
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base" />
          </label>}
          {error && <p role="alert" className="text-sm text-rose-700 font-bold">{error}</p>}
          <p className="text-xs leading-relaxed text-slate-500">최대 24시간까지 예약할 수 있습니다. 다른 메뉴에서도 유지되며, 청취 중지·새로고침 시 해제됩니다. 브라우저 종료나 PC 절전 중에는 정시 실행을 보장할 수 없습니다.</p>
          <div className="flex gap-2">
            {scheduledStop && <button type="button" onClick={() => { cancelScheduledStop(); setIsOpen(false); }} className="rounded-xl border border-rose-200 text-rose-700 px-3 py-2.5 text-sm font-bold">예약 취소</button>}
            <button type="submit" className="flex-1 rounded-xl bg-brand-600 hover:bg-brand-700 text-white px-3 py-2.5 text-sm font-bold">{scheduledStop ? '예약 변경' : '종료 예약 설정'}</button>
          </div>
        </form>
      </div>
    </div>}
  </>;
};

export const ListeningStopStatus: React.FC = () => {
  const { scheduledStop, remainingSeconds, completedAt, cancelScheduledStop, dismissCompletion } = useListeningStopSchedule();
  if (!scheduledStop && !completedAt) return null;
  return <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    <div className="flex items-center gap-2 min-w-0"><Clock className="w-4 h-4 flex-shrink-0" />
      {scheduledStop ? <p>종료 예약 <strong>{formatEndTime(scheduledStop.endsAt)}</strong> · 남은 시간 <strong role="timer" aria-live="off" className="font-mono tabular-nums">{formatListeningStopCountdown(remainingSeconds)}</strong></p>
        : <p>예약 시간이 되어 음성 청취와 댓글 캡처를 중지했습니다.</p>}
    </div>
    <button type="button" onClick={scheduledStop ? cancelScheduledStop : dismissCompletion}
      className="px-2 py-1 rounded-lg bg-white border border-amber-200 text-xs font-bold whitespace-nowrap">{scheduledStop ? '예약 취소' : '닫기'}</button>
  </div>;
};
