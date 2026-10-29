import React from 'react';
import type { TouchSale } from '../../types/touchSales';

export const TouchNumberBar: React.FC<{
  number: number;
  soldPrice?: number;
  disabled?: boolean;
  onChange: (n: number) => void;
}> = ({ number, soldPrice, disabled, onChange }) => (
  <div className="touch-number-bar" aria-label="상품번호">
    <button
      type="button"
      aria-label="이전 번호"
      disabled={disabled || number <= 1}
      onClick={() => onChange(number - 1)}
    >
      −
    </button>
    <input
      aria-label="지금 상품번호"
      inputMode="numeric"
      disabled={disabled}
      value={number}
      onChange={(e) => {
        const n = Number(e.target.value.replace(/\D/g, ''));
        if (n >= 1 && n <= 999) onChange(n);
      }}
    />
    <button
      type="button"
      aria-label="다음 번호"
      disabled={disabled || number >= 999}
      onClick={() => onChange(number + 1)}
    >
      ＋
    </button>
    <p>
      {soldPrice ? (
        <>
          <strong>
            {number}번 · {soldPrice.toLocaleString()}원 · 전표만
          </strong>
          지난 번호: 가격 입력과 캡처 없이 전표만 출력
        </>
      ) : (
        <>
          <strong>{number}번 · 새 상품</strong>
          고른 고객 모두 같은 가격으로 확정
        </>
      )}
    </p>
  </div>
);

const printSummary = (rows: TouchSale[]) =>
  rows.every((s) => s.printStatus === 'PRINTED')
    ? '전표 출력됨'
    : rows.some((s) => s.printStatus === 'FAILED')
      ? '전표 확인 필요'
      : '전표 대기';

/** 방금 확정한 판매를 판매내역을 열지 않고 고친다. */
export const TouchRecentSaleCard: React.FC<{
  rows: TouchSale[];
  label: string;
  captureOff: boolean;
  busy: boolean;
  now: number;
  onRetake: () => void;
  onPrice: () => void;
  onCancel: () => void;
}> = ({ rows, label, captureOff, busy, now, onRetake, onPrice, onCancel }) => {
  if (!rows.length) return null;
  const first = rows[0];
  const photo = rows.find((s) => s.imageUrl)?.imageUrl;
  const pending = rows.find((s) => s.captureStatus === 'PENDING');
  const skipped = rows.every((s) => s.captureStatus === 'SKIPPED');
  const names =
    rows.length > 1
      ? `${first.buyerNickname} 외 ${rows.length - 1}명`
      : first.buyerNickname;
  const amount = rows.reduce((n, s) => n + s.amount, 0);
  const seconds = pending
    ? Math.max(0, Math.ceil((Date.parse(pending.captureDueAt) - now) / 1000))
    : 0;
  return (
    <section className="touch-recent-card" aria-label="방금 판매">
      <button
        type="button"
        className="touch-recent-photo"
        aria-label="사진 다시 찍기"
        disabled={busy || captureOff}
        onClick={onRetake}
      >
        {photo ? (
          <img src={photo} alt="방금 판매 사진" />
        ) : pending ? (
          `${seconds}초 뒤 촬영`
        ) : skipped || captureOff ? (
          '캡처 안 함'
        ) : (
          '사진 없음'
        )}
      </button>
      <p>
        <strong>
          방금 판매 · {label ? `${label} · ` : ''}
          {names}
        </strong>
        {amount.toLocaleString()}원 · {printSummary(rows)}
      </p>
      <div>
        <button type="button" disabled={busy || captureOff} onClick={onRetake}>
          다시 찍기
        </button>
        <button type="button" disabled={busy} onClick={onPrice}>
          가격
        </button>
        <button
          type="button"
          className="touch-danger"
          disabled={busy}
          onClick={onCancel}
        >
          취소
        </button>
      </div>
    </section>
  );
};
