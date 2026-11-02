'use strict';
/**
 * 안드로이드 댓글 연결 관리자(Electron 메인 프로세스).
 * 서버 계약: docs/helper-android-link/CONTRACT.md
 *
 * - 판매자 계정 등록: 일회용 확인코드 + 비밀값 → 웹에서 로그인한 판매자가 승인 → 기기 토큰(OS 암호화 저장소에 보관).
 * - 폰 연결: 6자리 인증번호 발급 → 폰이 입력 → 이 화면에서 승인/거절.
 * - 켜짐 + 승인된 폰 + 폰의 활성 판매 회차가 모두 있을 때만 틱톡 수집을 요청하고 댓글을 서버로 보낸다.
 * - 판매 실행권은 폰에 있다. 이 관리자는 판매를 시작·중지하지 않는다.
 */

const HEARTBEAT_MS = 10000;
const FAST_HEARTBEAT_MS = 2000;
const REGISTER_POLL_MS = 2000;
const STOP_RETRY_MS = 1000;
const DROP_CODES = new Set(['STALE_GENERATION', 'SESSION_INACTIVE', 'HELPER_DISABLED']);
const REVOKED_CODES = new Set(['HELPER_NOT_FOUND', 'AUTH_REQUIRED', 'CAPABILITY_DENIED']);

class ApiError extends Error {
  constructor(code, message, status, retryable) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

class AndroidLinkManager {
  constructor(o) {
    this.o = {
      helperName: 'Windows PC',
      appVersion: '',
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t),
      now: () => Date.now(),
      log: () => {},
      onChange: () => {},
      post: () => {},
      openExternal: () => {},
      ...o,
    };
    this.creds = null;
    this.desiredEnabled = false;
    this.s = {
      registered: false,
      workspaceName: '',
      helperName: '',
      registering: null,
      serverEnabled: false,
      stateVersion: 0,
      generation: 0,
      sessionId: null,
      tiktokId: '',
      link: null,
      pendingRequests: [],
      pairCode: null,
      online: false,
      lastHeartbeatAt: null,
      lastPushAt: null,
      lastError: '',
      stopping: false,
      keyReady: false,
      collector: { state: 'idle', username: '', message: '', lastCommentAt: null },
    };
    this.heartbeatTimer = null;
    this.pushTimer = null;
    this.registerTimer = null;
    this.pushing = false;
    this.pushBackoff = 0;
    this.demand = null;
    this.started = false;
  }

  // ---------------------------------------------------------------- 서버 호출
  async api(action, body = {}, { device = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.o.apiKey) headers.apikey = this.o.apiKey;
    if (device) {
      if (!this.creds || !this.creds.deviceToken) throw new ApiError('HELPER_NOT_FOUND', '도우미가 등록되지 않았습니다.', 401, false);
      headers['x-voicecap-device-token'] = this.creds.deviceToken;
    }
    let res;
    try {
      res = await this.o.fetchFn(this.o.apiUrl, { method: 'POST', headers, body: JSON.stringify({ action, ...body }) });
    } catch (e) {
      throw new ApiError('NETWORK', `서버에 연결하지 못했습니다 (${e.message || e})`, 0, true);
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    // HTTP 성공 코드와 본문 ok를 함께 확인한다.
    if (!res.ok || !json || json.ok !== true) {
      const err = (json && json.error) || {};
      const code = err.code || (res.status === 401 ? 'AUTH_REQUIRED' : 'HTTP_' + res.status);
      throw new ApiError(code, err.message || `서버 오류 (${res.status})`, res.status, err.retryable ?? (res.status >= 500 || res.status === 429));
    }
    return json.data || {};
  }

  // ---------------------------------------------------------------- 수명
  start() {
    if (this.started) return;
    this.started = true;
    const saved = this.o.store.load() || {};
    this.desiredEnabled = saved.enabled === true;
    if (saved.deviceToken) {
      this.creds = { deviceToken: saved.deviceToken, deviceId: saved.deviceId };
      this.s.registered = true;
      this.s.workspaceName = saved.workspaceName || '';
      this.s.helperName = saved.helperName || '';
    }
    if (saved.storeError) this.s.lastError = saved.storeError;
    this.emit();
    if (this.s.registered) this.scheduleHeartbeat(0);
    this.schedulePush(0);
  }

  stop() {
    this.started = false;
    for (const t of [this.heartbeatTimer, this.pushTimer, this.registerTimer]) if (t) this.o.clearTimer(t);
    this.heartbeatTimer = this.pushTimer = this.registerTimer = null;
    this.setDemand(null);
    this.o.outbox.saveNow();
  }

  persist() {
    const result = this.o.store.save({
      enabled: this.desiredEnabled,
      deviceToken: this.creds ? this.creds.deviceToken : undefined,
      deviceId: this.creds ? this.creds.deviceId : undefined,
      workspaceName: this.s.workspaceName,
      helperName: this.s.helperName,
    });
    if (result && result.error) this.s.lastError = result.error;
  }

  // ---------------------------------------------------------------- 상태
  /** 화면·트레이에 보이는 한 줄 상태. 켜짐과 실제 전달 가능 상태를 구분한다. */
  deliveryState() {
    const s = this.s;
    if (!s.registered) return { key: 'unregistered', label: '판매자 계정 미등록' };
    if (!this.desiredEnabled) return s.stopping ? { key: 'stopping', label: '중지 반영 중' } : { key: 'off', label: '꺼짐' };
    if (!s.online) return { key: 'offline', label: '서버 연결 끊김 · 다시 연결 중' };
    if (!s.serverEnabled) return { key: 'starting', label: '켜는 중' };
    if (!s.link) return { key: 'no-phone', label: '연결된 폰 없음' };
    if (!s.sessionId) return { key: 'waiting-session', label: '폰 판매 시작 대기' };
    if (!s.tiktokId) return { key: 'error', label: '틱톡 ID 없음 · 폰 판매 설정에서 저장해 주세요' };
    if (!s.keyReady) return { key: 'error', label: s.lastError || '댓글 연결 키를 받는 중' };
    const c = s.collector.state;
    if (c === 'collecting') {
      const stats = this.o.outbox.stats();
      if (stats.error) return { key: 'error', label: stats.error };
      return { key: 'delivering', label: stats.pending > 50 ? `전달 중 · 미전송 ${stats.pending}건` : '전달 중' };
    }
    if (c === 'waiting_live') return { key: 'waiting-live', label: '방송 시작 대기' };
    if (c === 'connecting') return { key: 'connecting', label: '틱톡 연결 중' };
    if (c === 'ended') return { key: 'ended', label: '방송 종료됨' };
    if (c === 'error' || c === 'blocked') return { key: 'error', label: s.collector.message || '틱톡 수집 오류' };
    return { key: 'connecting', label: '틱톡 수집 준비 중' };
  }

  snapshot() {
    const stats = this.o.outbox.stats();
    return {
      ...this.s,
      enabled: this.desiredEnabled,
      delivery: this.deliveryState(),
      pending: stats.pending,
      dropped: stats.dropped + stats.overflow,
      queueError: stats.error,
    };
  }

  emit() {
    this.o.onChange(this.snapshot());
  }

  collectorState() {
    const stats = this.o.outbox.stats();
    return {
      tiktok: this.s.collector.state,
      username: this.s.collector.username,
      message: this.s.collector.message,
      lastCommentAt: this.s.collector.lastCommentAt,
      pending: stats.pending,
      dropped: stats.dropped + stats.overflow,
      queueError: stats.error,
      version: this.o.appVersion,
    };
  }

  /** 댓글 서버(utilityProcess)가 알려 주는 틱톡 수집 상태. */
  setCollector(status) {
    if (!status) return;
    // 수집 대상이 이 연결의 틱톡 ID가 아닐 때는 "수집 중"으로 보지 않는다.
    const username = String(status.username || '');
    const mine = !this.s.tiktokId || !username || username.toLowerCase() === this.s.tiktokId.toLowerCase();
    this.s.collector = {
      state: mine ? status.state || 'idle' : 'blocked',
      username,
      message: mine ? status.message || '' : `PC 웹이 다른 틱톡 계정(@${username})을 수집 중입니다.`,
      lastCommentAt: status.lastCommentAt || this.s.collector.lastCommentAt,
    };
    this.emit();
  }

  // ---------------------------------------------------------------- 생존 확인
  scheduleHeartbeat(ms) {
    if (!this.started) return;
    if (this.heartbeatTimer) this.o.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = this.o.setTimer(() => {
      this.heartbeatTimer = null;
      void this.heartbeat();
    }, ms);
  }

  async heartbeat() {
    if (!this.creds) return;
    try {
      if (this.s.serverEnabled !== this.desiredEnabled && this.s.online) await this.syncEnabled();
      const r = await this.api('helper-heartbeat', { state: this.collectorState() });
      this.s.online = true;
      this.s.lastHeartbeatAt = new Date(this.o.now()).toISOString();
      if (this.s.lastError && !this.s.lastError.startsWith('대기열')) this.s.lastError = '';
      this.apply(r);
      if (r.enabled !== this.desiredEnabled) await this.syncEnabled();
    } catch (e) {
      this.onApiError(e, 'heartbeat');
    } finally {
      const fast = this.s.pairCode || this.s.pendingRequests.length || this.s.stopping;
      this.scheduleHeartbeat(fast ? FAST_HEARTBEAT_MS : HEARTBEAT_MS);
      this.emit();
    }
  }

  apply(r) {
    const s = this.s;
    s.serverEnabled = r.enabled === true;
    s.stateVersion = r.stateVersion || 0;
    s.generation = r.generation || 0;
    s.sessionId = r.sessionId || null;
    s.tiktokId = r.tiktokId || '';
    s.link = r.link || null;
    s.pendingRequests = Array.isArray(r.pendingRequests) ? r.pendingRequests : [];
    if (r.workspaceName && r.workspaceName !== s.workspaceName) {
      s.workspaceName = r.workspaceName;
      this.persist();
    }
    if (s.pairCode && (s.link || Date.parse(s.pairCode.expiresAt) <= this.o.now())) s.pairCode = null;
    if (!s.serverEnabled && !this.desiredEnabled) s.stopping = false;
    // 회차·세대가 바뀌면 이전 대기열은 새 회차에 섞이지 않게 버린다.
    // (서버를 못 본 동안에는 apply가 불리지 않으므로 같은 세대 대기열은 그대로 남아 복구된다.)
    if (s.sessionId && s.generation) this.o.outbox.dropStale(s.sessionId, s.generation, '회차 또는 전달 세대가 바뀌었습니다.');
    this.updateDemand();
  }

  async syncEnabled() {
    const want = this.desiredEnabled;
    const r = await this.api('helper-set-enabled', { enabled: want });
    this.s.serverEnabled = r.enabled === true;
    this.s.generation = r.generation || this.s.generation;
    if (!want) this.s.stopping = false;
    this.updateDemand();
  }

  onApiError(e, where) {
    if (REVOKED_CODES.has(e.code) && e.status >= 400 && this.creds) {
      this.o.log(`등록 해제 감지 (${where}): ${e.code}`);
      this.forgetRegistration('이 PC의 판매자 계정 연결이 해제되었습니다. 다시 등록해 주세요.');
      return;
    }
    if (e.code === 'NETWORK' || e.status >= 500 || e.status === 0) {
      this.s.online = false;
      // 서버 확인 없이 계속 전달하지 않는다: 수집 요청은 유지하되(디스크에 보관) 상태는 끊김으로 보인다.
    }
    this.s.lastError = e.message;
    this.o.log(`${where} 실패: ${e.code} ${e.message}`);
  }

  forgetRegistration(message) {
    this.creds = null;
    Object.assign(this.s, {
      registered: false, serverEnabled: false, sessionId: null, link: null, pendingRequests: [], pairCode: null,
      online: false, workspaceName: '', helperName: '', keyReady: false, lastError: message || '',
    });
    this.o.outbox.clear('도우미 등록 해제');
    this.persist();
    this.updateDemand();
    this.emit();
  }

  // ---------------------------------------------------------------- 수집 요구
  /** 댓글 서버 프로세스가 다시 시작됐을 때: 키는 메모리에만 있으므로 다시 받고, 요구·등록 코드를 다시 알린다. */
  resendToServer() {
    this.demand = undefined;
    this.s.keyReady = false;
    if (this.s.registering) this.o.post('android:registration', { code: this.s.registering.code, expiresAt: this.s.registering.expiresAt });
    this.updateDemand();
  }

  updateDemand() {
    const s = this.s;
    // 서버와 잠시 끊겨도(같은 세대) 수집과 디스크 보관은 계속한다. 서버가 받지 않으면 그때 버린다.
    const want = this.desiredEnabled && s.serverEnabled && s.link && s.sessionId && s.tiktokId ? s.tiktokId : null;
    if (want && !s.keyReady) {
      void this.fetchKey().then(() => { if (this.s.keyReady) this.updateDemand(); });
      this.setDemand(null);
      return;
    }
    this.setDemand(want);
  }

  setDemand(username) {
    if (this.demand === username) return;
    this.demand = username;
    this.o.post('android:demand', { username });
    this.o.log(username ? `안드로이드 전달용 수집 요청: @${username}` : '안드로이드 전달용 수집 요청 해제');
  }

  async fetchKey() {
    if (this.keyBusy) return;
    this.keyBusy = true;
    try {
      const r = await this.api('helper-comment-key');
      this.o.post('android:key', { apiKey: r.apiKey });
      this.s.keyReady = true;
    } catch (e) {
      this.s.keyReady = false;
      this.onApiError(e, 'comment-key');
      this.s.lastError = e.code === 'COMMENT_KEY_MISSING' ? '관리자 메뉴에 댓글 연결 키가 없습니다.' : e.message;
    } finally {
      this.keyBusy = false;
      this.emit();
    }
  }

  /** 댓글 서버가 받은 댓글. 켜짐 + 활성 회차일 때만 그 회차·세대로 보관한다. */
  onComment(comment) {
    const s = this.s;
    if (!this.desiredEnabled || !s.serverEnabled || !s.sessionId || !s.generation || !s.link) return false;
    const ok = this.o.outbox.enqueue(comment, s.sessionId, s.generation);
    if (ok) this.schedulePush(0);
    return ok;
  }

  // ---------------------------------------------------------------- 전송
  schedulePush(ms) {
    if (!this.started) return;
    if (this.pushTimer) {
      if (ms > 0) return;
      this.o.clearTimer(this.pushTimer);
    }
    this.pushTimer = this.o.setTimer(() => {
      this.pushTimer = null;
      void this.pushOnce();
    }, ms);
  }

  async pushOnce() {
    if (this.pushing || !this.creds) return;
    const batch = this.o.outbox.nextBatch();
    if (!batch) return;
    this.pushing = true;
    let next = 0;
    try {
      const r = await this.api('helper-push', batch);
      const acked = Array.isArray(r.acked) ? r.acked : [];
      this.o.outbox.ack(batch, acked);
      this.o.outbox.clearOverflowIfRoom();
      this.pushBackoff = 0;
      this.s.online = true;
      this.s.lastPushAt = new Date(this.o.now()).toISOString();
      if (!acked.length) next = 1000;
    } catch (e) {
      if (DROP_CODES.has(e.code)) {
        this.o.outbox.dropWhere((i) => i.sessionId === batch.sessionId && i.generation === batch.generation, e.message);
        this.scheduleHeartbeat(0);
      } else if (e.code === 'VALIDATION_ERROR') {
        // 고쳐 보낼 수 없는 배치: 이유를 남기고 버린다(조용히 성공 처리하지 않는다).
        this.o.outbox.dropWhere((i) => i.batchId === batch.batchId, e.message);
        this.s.lastError = `전송 거절: ${e.message}`;
      } else {
        this.onApiError(e, 'push');
        this.pushBackoff = Math.min(30000, Math.max(1000, this.pushBackoff * 2));
        next = this.pushBackoff;
      }
    } finally {
      this.pushing = false;
      this.emit();
      if (this.o.outbox.stats().pending) this.schedulePush(next);
    }
  }

  // ---------------------------------------------------------------- 사용자 조작
  async setEnabled(enabled) {
    this.desiredEnabled = Boolean(enabled);
    this.persist();
    if (!this.desiredEnabled) {
      // 로컬 효과는 즉시: 새 댓글 보관과 수집 요청을 멈춘다. 서버 반영은 재시도한다.
      this.s.stopping = true;
      this.setDemand(null);
      this.o.outbox.clear('댓글 연결을 껐습니다.');
    }
    this.emit();
    if (!this.creds) return this.snapshot();
    try {
      await this.syncEnabled();
      this.s.online = true;
    } catch (e) {
      this.onApiError(e, 'set-enabled');
      if (!this.desiredEnabled) this.scheduleHeartbeat(STOP_RETRY_MS);
    }
    this.emit();
    this.scheduleHeartbeat(0);
    return this.snapshot();
  }

  async register() {
    if (this.s.registering) return this.snapshot();
    const secret = this.o.newSecret();
    try {
      const r = await this.api('helper-register-begin', {
        secret, helperName: this.o.helperName, appVersion: this.o.appVersion,
      }, { device: false });
      this.registerSecret = secret;
      this.s.registering = { registrationId: r.registrationId, code: r.code, expiresAt: r.expiresAt };
      this.s.lastError = '';
      this.o.post('android:registration', { code: r.code, expiresAt: r.expiresAt });
      this.o.openExternal(this.o.registerUrl);
      this.pollRegistration(REGISTER_POLL_MS);
    } catch (e) {
      this.s.lastError = e.message;
    }
    this.emit();
    return this.snapshot();
  }

  cancelRegister() {
    if (this.registerTimer) this.o.clearTimer(this.registerTimer);
    this.registerTimer = null;
    this.s.registering = null;
    this.registerSecret = null;
    this.o.post('android:registration', { code: null });
    this.emit();
    return this.snapshot();
  }

  pollRegistration(ms) {
    if (this.registerTimer) this.o.clearTimer(this.registerTimer);
    this.registerTimer = this.o.setTimer(async () => {
      this.registerTimer = null;
      const reg = this.s.registering;
      if (!reg) return;
      try {
        const r = await this.api('helper-register-poll', { registrationId: reg.registrationId, secret: this.registerSecret }, { device: false });
        if (r.status === 'REGISTERED' && r.deviceToken) {
          this.creds = { deviceToken: r.deviceToken, deviceId: r.deviceId };
          Object.assign(this.s, {
            registered: true, registering: null, workspaceName: r.workspaceName || '', helperName: r.helperName || '', lastError: '',
          });
          this.registerSecret = null;
          this.o.post('android:registration', { code: null });
          this.persist();
          this.emit();
          this.scheduleHeartbeat(0);
          return;
        }
        if (Date.parse(reg.expiresAt) <= this.o.now()) throw new Error('등록 시간이 지났습니다. 다시 시작해 주세요.');
        this.pollRegistration(REGISTER_POLL_MS);
      } catch (e) {
        if (e.retryable || e.code === 'NETWORK') {
          this.pollRegistration(REGISTER_POLL_MS * 2);
          return;
        }
        this.s.registering = null;
        this.s.lastError = e.message;
        this.o.post('android:registration', { code: null });
        this.emit();
      }
    }, ms);
  }

  async action(fn) {
    try {
      await fn();
      this.s.lastError = '';
    } catch (e) {
      this.onApiError(e, 'action');
      this.s.lastError = e.message;
    }
    this.emit();
    this.scheduleHeartbeat(0);
    return this.snapshot();
  }

  issueCode() {
    return this.action(async () => {
      const r = await this.api('helper-pair-issue');
      this.s.pairCode = { code: r.code, expiresAt: r.expiresAt };
    });
  }

  cancelCode() {
    return this.action(async () => {
      this.s.pairCode = null;
      await this.api('helper-pair-cancel');
    });
  }

  decide(linkId, approve) {
    return this.action(async () => {
      await this.api('helper-pair-decide', { linkId, approve: Boolean(approve) });
      if (approve) this.s.pairCode = null;
    });
  }

  unlink(linkId) {
    return this.action(async () => {
      await this.api('helper-unlink', { linkId });
      this.s.link = null;
      this.updateDemand();
    });
  }

  async unregister() {
    try {
      await this.api('helper-unregister');
    } catch (e) {
      if (!REVOKED_CODES.has(e.code)) {
        this.s.lastError = `서버에서 등록을 해제하지 못했습니다: ${e.message}`;
        this.emit();
        return this.snapshot();
      }
    }
    this.forgetRegistration('');
    return this.snapshot();
  }
}

module.exports = { AndroidLinkManager, ApiError };
