import React, { useEffect, useId, useState } from 'react';
import type { Buyer } from '../../types/productSales';

export function TouchBuyerChangeDialog({
  search,
  onSelect,
  onClose,
  busy = false,
}: {
  search: (query: string) => Promise<{ buyers: Buyer[] }>;
  onSelect: (buyer: Buyer) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    query: string;
    buyers: Buyer[];
    status: 'LOADING' | 'READY' | 'ERROR';
    error?: string;
  } | null>(null);
  const term = query.trim();

  useEffect(() => {
    if (!term || composing) {
      setResult(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setResult({ query: term, buyers: [], status: 'LOADING' });
      void search(term).then(
        ({ buyers }) => {
          if (active) setResult({ query: term, buyers, status: 'READY' });
        },
        () => {
          if (active) setResult({
            query: term, buyers: [], status: 'ERROR',
            error: '추천 닉네임을 불러오지 못했습니다. 다시 시도해 주세요.',
          });
        },
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [term, composing, retry, search]);

  const current = !composing && result?.query === term ? result : null;
  const loading = !!term && (!current || current.status === 'LOADING');
  const suggestions = current?.status === 'READY' ? current.buyers : [];

  return (
    <div className="touch-modal-backdrop" role="dialog" aria-modal="true" aria-label="구매자 변경">
      <section className="touch-modal touch-buyer-dialog">
        <h2>구매자 변경</h2>
        <label htmlFor={`${id}-query`}>닉네임 검색</label>
        <div className="touch-buyer-search">
          <input
            id={`${id}-query`}
            aria-label="구매자 이름 검색"
            aria-controls={`${id}-suggestions`}
            placeholder="닉네임을 입력하세요"
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setQuery(event.currentTarget.value);
              setComposing(false);
            }}
          />
          {query && (
            <button type="button" aria-label="검색어 지우기" disabled={busy} onClick={() => setQuery('')}>
              지우기
            </button>
          )}
        </div>
        <h3>추천 닉네임</h3>
        <p className="touch-buyer-search-status" role="status">
          {!term
            ? '닉네임을 입력하면 추천 목록이 표시됩니다.'
            : composing
              ? '닉네임 입력 중'
              : loading
                ? '추천 닉네임 찾는 중…'
                : current?.status === 'ERROR'
                  ? current.error
                  : suggestions.length
                    ? `${suggestions.length}명 · 변경할 구매자를 선택하세요.`
                    : '일치하는 닉네임이 없습니다.'}
        </p>
        {current?.status === 'ERROR' && (
          <button type="button" onClick={() => setRetry((value) => value + 1)} disabled={busy}>
            다시 시도
          </button>
        )}
        <ul id={`${id}-suggestions`} className="touch-buyer-suggestions" aria-label="추천 닉네임" aria-busy={loading}>
          {suggestions.map((buyer) => (
            <li key={buyer.id}>
              <button type="button" className="touch-buyer-option" disabled={busy} onClick={() => onSelect(buyer)}>
                <strong>{buyer.displayNickname}</strong>
                {buyer.platformUniqueId
                  ? <small>@{buyer.platformUniqueId}</small>
                  : buyer.platformUserId && <small>계정 ID: {buyer.platformUserId}</small>}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onClose} disabled={busy}>닫기</button>
      </section>
    </div>
  );
}
