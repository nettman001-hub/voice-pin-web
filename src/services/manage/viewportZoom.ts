/** 화면 확대 허용 여부를 viewport meta 로 바꾼다. 판매 화면만 막고 나머지는 허용한다. */
export const ZOOM_ALLOWED = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
export const ZOOM_BLOCKED = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

export function applyViewportZoom(allowed: boolean, doc: Document | undefined = globalThis.document): void {
  const meta = doc?.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const next = allowed ? ZOOM_ALLOWED : ZOOM_BLOCKED;
  if (meta.getAttribute('content') !== next) meta.setAttribute('content', next);
}
