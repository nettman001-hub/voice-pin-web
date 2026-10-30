import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, MoreHorizontal, Printer, Trash2 } from 'lucide-react';
import { isSalesApp } from '../../services/labelPrinter/androidBridge';
import { APP_HEADER_PX, createLongPress, totalsBarVisible } from '../../services/appLongPress';
import { formatWon } from '../../services/appShellState';
import type { ReprintSale } from '../../services/appReprint';
import { useAppReprint } from './useAppReprint';

/** 판매 앱([관리] 탭)의 판매내역 목록 전용 부품. 판매 앱이 아니면 아무것도 바꾸지 않는다. */

export type AppMenuTarget = {
  title: string;
  subtitle?: string;
  /** 상세 보기 주소(판매 한 건일 때). */
  detailHref?: string;
  /** 전표 다시 출력 대상(판매 한 건일 때). */
  reprint?: ReprintSale & { printStatus?: string; printError?: string };
  deleteLabel: string;
  /** 삭제 확인 문구에 붙이는 안내(실행 취소 가능 여부). */
  deleteNote?: string;
  onDelete: () => void;
};

const longPress = createLongPress();

/** 카드에 펼쳐 쓰는 속성: 길게 누르면 메뉴를 연다. 판매 앱이 아니면 빈 객체. */
export function appRowPress(onLongPress: () => void): React.HTMLAttributes<HTMLElement> & { draggable?: boolean } {
  if (!isSalesApp()) return {};
  return {
    onTouchStart: (e) => {
      if (e.touches.length !== 1) return longPress.cancel();
      longPress.start(e.touches[0].clientX, e.touches[0].clientY, onLongPress);
    },
    onTouchMove: (e) => {
      const touch = e.touches[0];
      if (touch) longPress.move(touch.clientX, touch.clientY);
    },
    onTouchEnd: () => longPress.end(),
    onTouchCancel: () => longPress.cancel(),
    // 길게 눌러 메뉴가 열린 직후에 따라오는 클릭(카드 열기·펼치기)은 무시한다.
    onClickCapture: (e) => {
      if (!longPress.consumeFired()) return;
      e.preventDefault();
      e.stopPropagation();
    },
    // 길게 눌렀을 때 웹뷰가 띄우는 링크 메뉴·끌기를 막는다.
    onContextMenu: (e) => e.preventDefault(),
    onDragStart: (e) => e.preventDefault(),
    draggable: false,
    style: { WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties,
  };
}

/** 카드 오른쪽 끝의 "⋯" 버튼. 판매 앱이 아니면 기존 버튼(fallback)을 그대로 보여 준다. */
export const AppRowActions: React.FC<{ onOpen: () => void; fallback: React.ReactNode; label?: string }> = ({
  onOpen,
  fallback,
  label = '메뉴 열기',
}) => {
  if (!isSalesApp()) return <>{fallback}</>;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 active:bg-slate-100"
    >
      <MoreHorizontal className="h-5 w-5" />
    </button>
  );
};

/** 위쪽 합계 카드가 화면 밖으로 올라가면 헤더 밑에 붙어 따라오는 한 줄 합계. 합계 카드 바로 아래에 둔다. */
export const AppTotalsBar: React.FC<{ count: number; amount: number; pending: number }> = ({ count, amount, pending }) => {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const app = isSalesApp();

  useEffect(() => {
    if (!app) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = sentinel.current;
      if (el) setVisible(totalsBarVisible(el.getBoundingClientRect().top, APP_HEADER_PX));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [app]);

  if (!app) return null;
  return (
    <>
      <div ref={sentinel} aria-hidden className="h-0" />
      {visible && (
        <div
          role="status"
          aria-label="판매 합계"
          className="fixed left-0 right-0 top-12 z-30 flex h-9 items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 text-xs backdrop-blur"
        >
          <span className="font-bold text-slate-700">
            총 {count}건
            {pending > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">보류 {pending}</span>}
          </span>
          <span className="text-sm font-black text-brand-600">{formatWon(amount)}</span>
        </div>
      )}
    </>
  );
};

/** 아래에서 올라오는 메뉴: 상세 보기, 전표 다시 출력, 삭제(한 번 더 확인). 열 때마다 새로 만들어 이전 출력 결과가 남지 않는다. */
export const AppSaleMenuSheet: React.FC<{ target: AppMenuTarget | null; onClose: () => void }> = ({ target, onClose }) =>
  isSalesApp() && target ? <SheetBody target={target} onClose={onClose} /> : null;

const SheetBody: React.FC<{ target: AppMenuTarget; onClose: () => void }> = ({ target, onClose }) => {
  const { result, run, working } = useAppReprint();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tone = result?.state === 'failed' ? 'text-rose-700' : result?.state === 'ok' || result?.state === 'queued' ? 'text-emerald-700' : 'text-slate-600';
  const rowClass = 'flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-4 text-left text-sm font-bold active:bg-slate-100';
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`${target.title} 메뉴`}
      // 길게 눌러 메뉴가 열린 직후 손가락을 뗄 때 따라오는 클릭이 방금 열린 메뉴를 닫거나 누르지 않게 한다.
      onClickCapture={(e) => {
        if (!longPress.consumeFired()) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative rounded-t-3xl bg-white p-3 pb-6 shadow-2xl">
        <div className="px-4 pb-2 pt-1">
          <p className="truncate text-base font-black text-slate-900">{target.title}</p>
          {target.subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{target.subtitle}</p>}
        </div>
        {confirmDelete ? (
          <div className="space-y-3 px-1 pt-1">
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
              {target.deleteLabel}할까요? {target.deleteNote}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-[52px] rounded-2xl border border-slate-200 text-sm font-bold text-slate-700 active:bg-slate-100">
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  target.onDelete();
                  onClose();
                }}
                className="min-h-[52px] rounded-2xl bg-rose-600 text-sm font-black text-white active:bg-rose-700"
              >
                삭제
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {target.detailHref && (
              <Link to={target.detailHref} onClick={onClose} className={`${rowClass} text-slate-800`}>
                <Eye className="h-5 w-5 text-slate-500" />
                상세 보기·수정
              </Link>
            )}
            {target.reprint && (
              <>
                <button type="button" disabled={working} onClick={() => void run(target.reprint!)} className={`${rowClass} text-slate-800 disabled:opacity-50`}>
                  <Printer className="h-5 w-5 text-slate-500" />
                  전표 다시 출력
                  {target.reprint.printStatus === 'FAILED' && <span className="text-xs font-bold text-rose-600">직전 출력 실패</span>}
                </button>
                {result && (
                  <div role="status" className={`px-4 pb-1 text-xs font-bold ${tone}`}>
                    {result.message}
                    {result.state === 'needConnect' && (
                      <button
                        type="button"
                        onClick={() => void run(target.reprint!, true)}
                        className="ml-2 min-h-[40px] rounded-lg bg-brand-600 px-3 py-1.5 text-white"
                      >
                        프린터 연결 후 출력
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            <button type="button" onClick={() => setConfirmDelete(true)} className={`${rowClass} text-rose-700`}>
              <Trash2 className="h-5 w-5" />
              {target.deleteLabel}
            </button>
            <button type="button" onClick={onClose} className={`${rowClass} justify-center text-slate-600`}>
              닫기
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
