/**
 * 판매 앱의 목록 카드를 길게 눌러 메뉴를 여는 동작.
 * 손가락이 조금(slop) 넘게 움직이면 스크롤로 보고 취소한다. 길게 누른 직후에 따라오는 클릭은 한 번 삼킨다.
 */
export type LongPressTimers = {
  set(callback: () => void, ms: number): unknown;
  clear(id: unknown): void;
  now(): number;
};

const realTimers: LongPressTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** 길게 누른 뒤 손을 뗀 때부터 이 시간 안에 오는 클릭만 삼킨다(클릭이 안 오는 기기에서 다음 탭을 막지 않도록). */
const CLICK_SWALLOW_MS = 800;

export function createLongPress(options: { delayMs?: number; slopPx?: number; timers?: LongPressTimers } = {}) {
  const delayMs = options.delayMs ?? 500;
  const slopPx = options.slopPx ?? 10;
  const timers = options.timers ?? realTimers;
  let timer: unknown = null;
  let originX = 0;
  let originY = 0;
  // 메뉴가 열린 누르기: 손을 떼기 전(pressing)이거나 뗀 지 얼마 안 됐으면 따라오는 클릭을 삼킨다.
  let fired = false;
  let pressing = false;
  let releasedAt = -Infinity;

  const clearTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  return {
    start(x: number, y: number, onLongPress: () => void) {
      clearTimer();
      fired = false;
      pressing = true;
      originX = x;
      originY = y;
      timer = timers.set(() => {
        timer = null;
        fired = true;
        onLongPress();
      }, delayMs);
    },
    move(x: number, y: number) {
      if (timer !== null && (Math.abs(x - originX) > slopPx || Math.abs(y - originY) > slopPx)) clearTimer();
    },
    end() {
      clearTimer();
      pressing = false;
      releasedAt = timers.now();
    },
    cancel() {
      clearTimer();
      pressing = false;
      releasedAt = timers.now();
    },
    /** 길게 눌러 메뉴가 열렸다면 그 직후의 클릭 한 번을 무시하라고 알려 준다. */
    consumeFired() {
      const swallow = fired && (pressing || timers.now() - releasedAt <= CLICK_SWALLOW_MS);
      fired = false;
      return swallow;
    },
  };
}

/** 합계 줄은 위쪽 합계 카드가 헤더 밑으로 완전히 올라간 뒤에만 보여 준다. */
export const APP_HEADER_PX = 48;
export const totalsBarVisible = (sentinelTop: number, headerPx = APP_HEADER_PX) => sentinelTop < headerPx;
