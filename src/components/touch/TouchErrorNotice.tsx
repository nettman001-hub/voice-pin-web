import React from 'react';

export function TouchErrorNotice({
  message,
  onDismiss,
  className = '',
}: {
  message: string;
  onDismiss: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div role="alert" className={`touch-error touch-dismissible-error ${className}`}>
      <span>{message}</span>
      <button type="button" aria-label="경고 닫기" onClick={onDismiss}>
        닫기
      </button>
    </div>
  );
}
