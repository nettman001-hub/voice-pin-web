import React, { useEffect, useRef, useState } from 'react';
import type { TouchComment, TouchSalesMode } from '../../types/touchSales';
import {
  touchCommentTone,
  touchModeUsesNumber,
} from '../../services/touchSaleModes';
import {
  isTouchListAtBottom,
  isTouchPurchase,
  shouldFlashTouchComment,
  touchCommentKey,
  type TouchSelectionState,
} from '../../services/touchCommentState';
import { customerStatsLabel } from '../../services/customerStatsIndex';
interface Props {
  comments: TouchComment[];
  selection: TouchSelectionState;
  sold: ReadonlyMap<string, string>;
  enabled: boolean;
  selectedComment?: TouchComment | null;
  onSearch?: (query: string) => void;
  onSelect: (comment: TouchComment) => void;
  onCancel: () => void;
  onConfirm: () => void;
  /** 상품번호·사이즈·색상 방식: 여러 댓글을 고르고 아래 줄은 화면이 그린다. */
  mode?: TouchSalesMode;
  currentNumber?: number;
  picked?: readonly string[];
  footer?: React.ReactNode;
  /** 아무것도 고르지 않았을 때 선택 줄 자리에 보일 내용(방금 판매 칸). */
  idleFooter?: React.ReactNode;
  onOpenSold?: (key: string) => void;
}
export const TouchCommentList: React.FC<Props> = ({
  comments,
  selection,
  sold,
  enabled,
  selectedComment,
  onSearch,
  onSelect,
  onCancel,
  onConfirm,
  mode,
  currentNumber = 1,
  picked,
  footer,
  idleFooter,
  onOpenSold,
}) => {
  const multi = touchModeUsesNumber(mode);
  const pickedSet = new Set(picked || []);
  const [search, setSearch] = useState(''),
    [purchasesOnly, setPurchasesOnly] = useState(false),
    [following, setFollowing] = useState(true),
    [unread, setUnread] = useState(0),
    [author, setAuthor] = useState('');
  const list = useRef<HTMLDivElement | null>(null),
    lastSequence = useRef(0),
    longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected =
    comments.find((c) => touchCommentKey(c) === selection.selectedKey) ||
    (selectedComment &&
    touchCommentKey(selectedComment) === selection.selectedKey
      ? selectedComment
      : null);
  useEffect(() => {
    const timer = setTimeout(() => onSearch?.(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search, onSearch]);
  const visible = comments.filter(
    (c) =>
      (!search ||
        c.nickname.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ||
        (c.uniqueId || '')
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())) &&
      (!purchasesOnly || isTouchPurchase(c)) &&
      (!author || (c.platformUserId || c.uniqueId || c.nickname) === author),
  );
  useEffect(() => {
    const latest = comments[comments.length - 1]?.sequence || 0;
    const added = comments.filter(
      (c) => c.sequence > lastSequence.current,
    ).length;
    if (following) {
      if (list.current) list.current.scrollTop = list.current.scrollHeight;
      setUnread(0);
    } else if (latest > lastSequence.current) setUnread((n) => n + added);
    lastSequence.current = latest;
  }, [comments, following]);
  useEffect(
    () => () => {
      if (longPress.current) clearTimeout(longPress.current);
    },
    [],
  );
  // 번호를 바꾸면 그 번호 댓글로 이동한다. 댓글을 고르는 중에는 움직이지 않는다.
  useEffect(() => {
    if (mode !== 'NUMBER' || pickedSet.size || !list.current) return;
    const target = list.current.querySelector<HTMLElement>(
      `[data-product-number="${currentNumber}"]`,
    );
    if (target) {
      setFollowing(false);
      target.scrollIntoView({ block: 'center' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentNumber]);
  const cancelLong = () => {
    if (longPress.current) clearTimeout(longPress.current);
    longPress.current = null;
  };
  return (
    <section className="touch-selling-panel" aria-label="댓글에서 구매자 선택">
      <div className="touch-search-bar">
        <input
          aria-label="닉네임 검색"
          placeholder="⌕ 닉네임 검색"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setFollowing(false);
          }}
        />
        <button
          type="button"
          aria-pressed={!purchasesOnly}
          className={!purchasesOnly ? 'active' : ''}
          onClick={() => setPurchasesOnly(false)}
        >
          전체
        </button>
        <button
          type="button"
          aria-pressed={purchasesOnly}
          className={purchasesOnly ? 'active' : ''}
          onClick={() => setPurchasesOnly(true)}
        >
          구매댓글만
        </button>
      </div>
      {author && (
        <button className="touch-author-filter" onClick={() => setAuthor('')}>
          이 고객 댓글만 보는 중 · 전체 보기 ×
        </button>
      )}
      <div
        className="touch-comment-scroll"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (isTouchListAtBottom(el.scrollHeight, el.scrollTop, el.clientHeight)) {
            setFollowing(true);
            setUnread(0);
          } else setFollowing(false);
        }}
      >
        {!visible.length && (
          <p className="touch-empty">
            {comments.length
              ? '검색 조건에 맞는 댓글이 없습니다.'
              : 'PC에서 판매 시작 후 실시간 댓글이 이곳에 표시됩니다.'}
          </p>
        )}
        {visible.map((c) => {
          const key = touchCommentKey(c),
            purchase = isTouchPurchase(c),
            isSelected = multi
              ? pickedSet.has(key)
              : selection.selectedKey === key,
            saleId = sold.get(key);
          const tone = touchCommentTone(c, mode, currentNumber);
          const flash = multi
            ? tone.tone === 'CURRENT' && !saleId
            : shouldFlashTouchComment(c, selection, new Set(sold.keys()));
          const light =
            multi && !saleId && (tone.tone === 'INTENT' || tone.tone === 'OTHER');
          const noNumber =
            mode === 'NUMBER' && isSelected && tone.tone !== 'CURRENT';
          return (
            <button
              type="button"
              key={key}
              data-comment-id={c.platformMessageId || c.id}
              data-product-number={tone.number ?? undefined}
              aria-pressed={isSelected}
              className={`touch-comment-row ${flash ? 'touch-purchase-flash' : ''} ${light ? 'touch-intent-light' : ''} ${purchase ? 'touch-purchase-row' : ''} ${isSelected ? 'touch-comment-selected' : ''} ${noNumber ? 'touch-pick-no-number' : ''} ${saleId ? 'touch-comment-sold' : ''}`}
              onClick={() => {
                setFollowing(false);
                onSelect(c);
              }}
            >
              <span className="touch-comment-top">
                <strong
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    longPress.current = setTimeout(
                      () =>
                        setAuthor(c.platformUserId || c.uniqueId || c.nickname),
                      650,
                    );
                  }}
                  onPointerUp={cancelLong}
                  onPointerCancel={cancelLong}
                >
                  {c.nickname}
                </strong>
                {saleId ? (
                  <small
                    className="touch-sold-label"
                    role={onOpenSold ? 'link' : undefined}
                    onClick={(e) => {
                      if (!onOpenSold) return;
                      e.stopPropagation();
                      onOpenSold(key);
                    }}
                  >
                    판매됨 {saleId}
                    {onOpenSold ? ' · 고치기' : ''}
                  </small>
                ) : purchase ? (
                  <small className="touch-purchase-label">구매</small>
                ) : null}
                {tone.tone === 'OTHER' && !saleId && (
                  <small className="touch-number-badge">{tone.number}번</small>
                )}
                {noNumber && (
                  <small className="touch-no-number-label">번호 없음</small>
                )}
                {isSelected && (
                  <span className="touch-selected-check" aria-label="선택됨">
                    ✓
                  </span>
                )}
                <time>
                  {new Date(c.capturedAt).toLocaleTimeString('ko-KR', {
                    hour12: false,
                  })}
                </time>
              </span>
              {c.uniqueId && (
                <span className="touch-account-id">@{c.uniqueId}</span>
              )}
              <span className="touch-comment-body">
                {c.content}
                {c.stats && (
                  <small
                    className={`touch-customer-stats ${c.stats.defaultCount ? 'has-default' : ''}`}
                  >
                    {' '}
                    · {customerStatsLabel({ ...c.stats, validSales: [] })}
                  </small>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {!following && unread > 0 && (
        <button
          type="button"
          className="touch-new-comments"
          onClick={() => {
            setFollowing(true);
            setUnread(0);
          }}
        >
          새 댓글 {unread}개 ↓
        </button>
      )}
      {footer ? (
        footer
      ) : !selected && idleFooter ? (
        idleFooter
      ) : (
      <footer className="touch-selection-bar">
        <p>
          {selected ? (
            <>
              <strong>선택: {selected.nickname}</strong> · “{selected.content}”
            </>
          ) : (
            <>🟡 깜빡이는 구매 댓글을 눌러 구매자를 고르세요</>
          )}
        </p>
        <div>
          <button type="button" onClick={onCancel} disabled={!selected}>
            취소
          </button>
          <button
            type="button"
            className="touch-primary"
            onClick={onConfirm}
            disabled={!selected || !enabled}
          >
            확인
          </button>
        </div>
      </footer>
      )}
    </section>
  );
};
