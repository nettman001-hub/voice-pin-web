interface RefreshOptions {
  refresh: () => Promise<unknown>;
  isVisible: () => boolean;
  isOnline: () => boolean;
  listen: (resume: () => void) => () => void;
  intervalMs?: number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

// For display-only refreshes: work/capture queues do not use this scheduler.
export function startVisibleRefresh(options: RefreshOptions) {
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const intervalMs = options.intervalMs || 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let failures = 0;
  const allowed = () => !stopped && options.isVisible() && options.isOnline();
  const clear = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  const run = async () => {
    if (!allowed() || running) return;
    clear();
    running = true;
    try { await options.refresh(); failures = 0; }
    catch { failures++; }
    finally {
      running = false;
      if (allowed()) timer = setTimer(() => void run(), Math.min(intervalMs * 2 ** failures, 300_000));
    }
  };
  const resume = () => { clear(); if (allowed()) void run(); };
  const unlisten = options.listen(resume);
  void run();
  return () => { stopped = true; clear(); unlisten(); };
}
