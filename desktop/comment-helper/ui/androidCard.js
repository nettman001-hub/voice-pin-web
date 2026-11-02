/* 안드로이드 댓글 연결 카드. 상태는 메인 프로세스(androidLink)가 helper:status의 android로 보낸다. */
(function initAndroidCard(root) {
  const TONES = {
    delivering: 'collecting',
    'waiting-session': 'running',
    'waiting-live': 'running',
    connecting: 'starting',
    starting: 'starting',
    stopping: 'starting',
    off: 'idle',
    unregistered: 'idle',
    'no-phone': 'idle',
    ended: 'running',
    offline: 'error',
    error: 'error',
  };

  function fmtTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function remaining(iso, now) {
    const ms = Date.parse(iso || '') - now;
    if (!Number.isFinite(ms) || ms <= 0) return '시간 지남';
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} 남음`;
  }

  /** 화면에 보일 값만 계산한다(시험 가능). */
  function androidView(a, now = Date.now()) {
    if (!a) return { visible: false };
    const delivery = a.delivery || { key: 'off', label: '꺼짐' };
    return {
      visible: true,
      registered: Boolean(a.registered),
      tone: TONES[delivery.key] || 'idle',
      statusLabel: delivery.label,
      enabled: Boolean(a.enabled),
      canToggle: Boolean(a.registered),
      account: a.registered ? `${a.workspaceName || '판매자'} · ${a.helperName || '이 PC'}` : '등록되지 않음',
      registeringCode: a.registering ? a.registering.code : '',
      registeringLeft: a.registering ? remaining(a.registering.expiresAt, now) : '',
      pairCode: a.pairCode ? a.pairCode.code : '',
      pairLeft: a.pairCode ? remaining(a.pairCode.expiresAt, now) : '',
      requests: (a.pendingRequests || []).map((r) => ({
        id: r.id,
        title: r.phoneName || 'Android',
        detail: `${r.userEmail || '판매자'} · ${fmtTime(r.requestedAt)} 요청 · ${remaining(r.expiresAt, now)}`,
      })),
      phone: a.link ? { id: a.link.id, name: a.link.phoneName || 'Android', lastSeen: fmtTime(a.link.lastSeenAt) } : null,
      session: a.sessionId ? `진행 중 (회차 ${String(a.sessionId).slice(0, 8)})` : '없음',
      tiktok: a.tiktokId ? `@${a.tiktokId}` : '-',
      lastPush: fmtTime(a.lastPushAt),
      pending: `${Number(a.pending || 0).toLocaleString('ko-KR')}건`,
      dropped: Number(a.dropped || 0),
      error: a.queueError || a.lastError || '',
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { androidView };
  const doc = root.document;
  if (!doc || !root.voicecap || !doc.querySelector('#android-card')) return;

  const $ = (id) => doc.querySelector(`#${id}`);
  const api = root.voicecap;
  let last = null;
  let busy = false;

  function button(label, className, onClick) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    try {
      const snapshot = await fn();
      if (snapshot) render(snapshot);
    } catch (e) {
      $('android-error').textContent = e && e.message ? e.message : '처리하지 못했습니다.';
      $('android-error').hidden = false;
    } finally {
      busy = false;
    }
  }

  function render(a) {
    last = a;
    const v = androidView(a);
    $('android-card').hidden = !v.visible;
    if (!v.visible) return;
    $('android-dot').className = `status-dot ${v.tone}`;
    $('android-status').textContent = v.statusLabel;
    $('android-enabled').checked = v.enabled;
    $('android-enabled').disabled = !v.canToggle;
    $('android-account').textContent = v.account;
    $('android-register').hidden = v.registered || Boolean(v.registeringCode);
    $('android-unregister').hidden = !v.registered;

    $('android-registering').hidden = !v.registeringCode;
    $('android-registering-code').textContent = v.registeringCode;
    $('android-registering-left').textContent = v.registeringLeft;

    $('android-registered').hidden = !v.registered;
    $('android-pair').hidden = !v.registered || Boolean(v.phone);
    $('android-pair-code').textContent = v.pairCode || '------';
    $('android-pair-left').textContent = v.pairCode ? v.pairLeft : '인증번호를 발급하면 폰 판매 앱에 입력합니다.';
    $('android-issue-code').textContent = v.pairCode ? '재발급' : '폰 연결 인증번호 발급';
    $('android-cancel-code').hidden = !v.pairCode;

    const list = $('android-requests');
    list.replaceChildren(...v.requests.map((r) => {
      const row = doc.createElement('div');
      row.className = 'android-request';
      const text = doc.createElement('div');
      const strong = doc.createElement('strong');
      strong.textContent = `${r.title} 연결 요청`;
      const p = doc.createElement('p');
      p.textContent = r.detail;
      text.append(strong, p);
      const actions = doc.createElement('div');
      actions.className = 'android-request-actions';
      actions.append(
        button('승인', 'secondary-button', () => run(() => api.androidDecide(r.id, true))),
        button('거절', 'text-button', () => run(() => api.androidDecide(r.id, false))),
      );
      row.append(text, actions);
      return row;
    }));
    list.hidden = !v.requests.length;

    $('android-phone').hidden = !v.phone;
    if (v.phone) {
      $('android-phone-name').textContent = v.phone.name;
      $('android-phone-seen').textContent = `최근 접속 ${v.phone.lastSeen}`;
    }
    $('android-session').textContent = v.session;
    $('android-tiktok').textContent = v.tiktok;
    $('android-last-push').textContent = v.lastPush;
    $('android-pending').textContent = v.pending;
    $('android-dropped').textContent = v.dropped ? `버린 댓글 ${v.dropped}건 (꺼짐·회차 변경)` : '';
    $('android-error').textContent = v.error;
    $('android-error').hidden = !v.error;
  }

  $('android-enabled').addEventListener('change', () => {
    const want = $('android-enabled').checked;
    void run(() => api.androidSetEnabled(want));
  });
  $('android-register').addEventListener('click', () => run(() => api.androidRegister()));
  $('android-cancel-register').addEventListener('click', () => run(() => api.androidCancelRegister()));
  $('android-unregister').addEventListener('click', () => {
    if (!root.confirm('이 PC의 판매자 계정 연결을 해제할까요? 연결된 폰도 함께 해제됩니다.')) return;
    void run(() => api.androidUnregister());
  });
  $('android-issue-code').addEventListener('click', () => run(() => api.androidIssueCode()));
  $('android-cancel-code').addEventListener('click', () => run(() => api.androidCancelCode()));
  $('android-unlink').addEventListener('click', () => {
    if (!last || !last.link) return;
    if (!root.confirm(`${last.link.phoneName || '폰'} 연결을 해제할까요? 같은 폰도 다시 승인받아야 합니다.`)) return;
    void run(() => api.androidUnlink(last.link.id));
  });

  api.onStatus((status) => render(status.android));
  api.androidGet().then(render).catch(() => {});
  // 남은 시간 표시 갱신.
  root.setInterval(() => { if (last && (last.pairCode || last.registering || (last.pendingRequests || []).length)) render(last); }, 1000);
})(typeof window !== 'undefined' ? window : globalThis);
