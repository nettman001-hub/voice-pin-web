// One active live/STT input per browser origin, including production and test
// tabs. A test must not take over the operating helper's microphone session.
export async function acquireListeningInput(): Promise<() => void> {
  if (typeof navigator === 'undefined' || !navigator.locks) return () => {};
  let acquire!: (release: () => void) => void;
  let fail!: (error: unknown) => void;
  const ready = new Promise<() => void>((resolve, reject) => { acquire = resolve; fail = reject; });
  void navigator.locks.request('voicecap-live-listening-input', { ifAvailable: true }, async lock => {
    if (!lock) { fail(new Error('다른 탭에서 라이브 청취 중입니다. 해당 청취를 중지한 뒤 시작해 주세요.')); return; }
    await new Promise<void>(release => acquire(release));
  }).catch(fail);
  return ready;
}
