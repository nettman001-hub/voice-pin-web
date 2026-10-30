/** WebView 탭 전환은 브라우저의 focus/BroadcastChannel 알림 없이 일어날 수 있다. */
export const watchSalesAppAuthSync = (sync: (sharedSessionChanged: boolean) => void): (() => void) => {
  if (typeof window === 'undefined' || !(window as unknown as { VoiceCapAndroid?: unknown }).VoiceCapAndroid)
    return () => {};

  let timer: number | undefined;
  let sharedSessionChanged = false;
  const schedule = (shared = false) => {
    sharedSessionChanged ||= shared;
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      const changed = sharedSessionChanged;
      sharedSessionChanged = false;
      sync(changed);
    }, 0);
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== null && !/^sb-.+-auth-token(?:-user)?$/.test(event.key)) return;
    // sessionStorage는 웹뷰마다 다르므로 다른 웹뷰의 공용 저장소 변경만 받는다.
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
    } catch { return; }
    schedule(true);
  };
  const focus = () => schedule();
  const visibility = () => { if (document.visibilityState === 'visible') schedule(); };
  const native = (event: Event) => {
    let detail = (event as CustomEvent).detail;
    if (typeof detail === 'string') {
      try { detail = JSON.parse(detail); } catch { return; }
    }
    if (detail?.type === 'app-tab-active') schedule();
  };
  window.addEventListener('storage', storage);
  window.addEventListener('focus', focus);
  window.addEventListener('voicecap-android', native);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', focus);
    window.removeEventListener('voicecap-android', native);
    document.removeEventListener('visibilitychange', visibility);
  };
};
