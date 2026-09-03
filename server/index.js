/**
 * VoiceCAP 틱톡 라이브 댓글 실시간 수집 로컬 서버
 *
 * 구조:
 *   [TikTok LIVE] <--WSS-- [본 서버 (tiktok-live-connector)] --Socket.IO--> [Vercel 웹앱 브라우저]
 *
 * - 127.0.0.1 에서만 리슨하므로 외부에 노출되지 않는다.
 * - HTTPS 페이지(Vercel)에서 ws://localhost 접속은 Chrome/Edge/Firefox 모두 허용된다.
 * - WebSocket URL 서명은 Euler Stream 서명 서버를 사용한다 (무료 커뮤니티 한도, API 키로 상향).
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { BridgeStore } = require('./bridgeStore');
const { createBridgeRouter } = require('./bridgeApi');
const {
  TikTokLiveConnection,
  WebcastEvent,
  SignConfig
} = require('tiktok-live-connector');

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '2137', 10);
const HOST = process.env.HOST || '127.0.0.1';
const SMS_BRIDGE_API_KEY = String(process.env.SMS_BRIDGE_API_KEY || '').trim();
const SMS_BRIDGE_DATA_FILE = process.env.SMS_BRIDGE_DATA_FILE || path.join(__dirname, 'data', 'bridge.json');

function resolveEulerApiKey() {
  const fromEnv = (process.env.EULERSTREAM_API_KEY || '').trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    path.join(__dirname, 'eulerstream_key.txt'),
    path.join(__dirname, '..', 'eulerstream_key.txt')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const key = fs.readFileSync(p, 'utf8').trim();
        if (key) return key;
      }
    } catch (_) { /* 읽기 실패 무시 */ }
  }
  return '';
}

const EULER_API_KEY = resolveEulerApiKey();
if (EULER_API_KEY) {
  // v2.x: 전역 SignConfig에 API 키를 등록해야 커뮤니티 한도가 아니라 계정 한도로 동작한다.
  SignConfig.apiKey = EULER_API_KEY;
} else {
  console.warn('[설정] Euler Stream API 키 없음 - 무료 커뮤니티 한도로 제한될 수 있다.');
}

const DEFAULT_ORIGINS = [
  'https://voicecap.shop',
  'https://www.voicecap.shop',
  'https://voice-pin-web.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
];
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : DEFAULT_ORIGINS)
    .map((o) => o.trim())
    .filter(Boolean)
);

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------
let connection = null;          // TikTokLiveConnection
let desiredUsername = '';       // 수집 대상 틱톡 ID (@ 제외)
let manualStop = false;         // 클라이언트가 의도적으로 중지했는가
let streamEnded = false;        // 틱톡 방송이 정상 종료되었는가
let reconnectAttempts = 0;
let reconnectTimer = null;
let serverState = 'idle';       // idle | connecting | collecting | waiting_live | ended | error
let serverMessage = '대기 중';
let viewerCount = 0;
const stats = {
  startedAt: null,              // 현재 컬렉션 시작 시각
  lastCommentAt: null,
  totalComments: 0,
  reconnects: 0
};

// Electron utilityProcess에서 메인 프로세스(Windows 프린터 제어)로 전달할 인쇄 요청.
// 이 서버는 브라우저와 통신만 맡고 실제 silent print 권한은 Electron 메인이 가진다.
const pendingPrintRequests = new Map();

function sendPrintToHelper(payload, acknowledge) {
  if (!process.parentPort) {
    acknowledge({ ok: false, status: 'FAILED', error: '댓글 도우미 앱에서만 자동 출력할 수 있습니다.' });
    return;
  }
  const requestId = `print-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const timer = setTimeout(() => {
    const pending = pendingPrintRequests.get(requestId);
    if (!pending) return;
    pendingPrintRequests.delete(requestId);
    pending.acknowledge({ ok: false, status: 'FAILED', error: '댓글 도우미의 인쇄 응답 시간이 초과되었습니다.' });
  }, 20000);
  pendingPrintRequests.set(requestId, { acknowledge, timer });
  process.parentPort.postMessage({ type: 'print:sale', requestId, payload });
}

if (process.parentPort) {
  process.parentPort.on('message', (event) => {
    const message = event && event.data ? event.data : event;
    if (!message || message.type !== 'print:result') return;
    const pending = pendingPrintRequests.get(message.requestId);
    if (!pending) return;
    pendingPrintRequests.delete(message.requestId);
    clearTimeout(pending.timer);
    pending.acknowledge(message.result || { ok: false, status: 'FAILED', error: '인쇄 결과가 비어 있습니다.' });
  });
}

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString('ko-KR')}]`, ...args);
}

function normalizeUsername(raw) {
  let u = String(raw || '').trim();
  u = u.replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '');
  u = u.replace(/^@/, '');
  u = u.replace(/[/?#].*$/, '');
  return u.trim();
}

// ---------------------------------------------------------------------------
// Express + Socket.IO
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '16mb' }));

// 최신 크롬 Private Network Access(PNA): 공개 HTTPS 페이지에서 로컬(127.0.0.1) 서버로
// 접속할 때 브라우저가 preflight에 이 헤더를 요구하므로 반드시 응답해야 한다.
app.use((req, res, next) => {
  if (String(req.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      return cb(new Error(`허용되지 않은 오리진: ${origin}`));
    }
  })
);

app.get('/status', (_req, res) => {
  res.json({
    ok: true,
    service: 'voicecap-comment-server',
    hasEulerApiKey: Boolean(EULER_API_KEY),
    tiktok: {
      state: serverState,
      username: desiredUsername,
      message: serverMessage,
      viewerCount,
      ...stats
    },
    socketClients: io.engine.clientsCount
  });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      return cb(new Error(`허용되지 않은 오리진: ${origin}`));
    },
    // 크롬의 WebSocket PNA preflight가 요청할 수 있는 메서드 전부 허용
    methods: ['GET', 'POST', 'OPTIONS', 'CONNECT']
  }
});

const bridgeStore = new BridgeStore(SMS_BRIDGE_DATA_FILE);
app.use('/api', createBridgeRouter({
  store: bridgeStore,
  apiKey: SMS_BRIDGE_API_KEY,
  onEvent: (eventName, payload) => io.emit(eventName, payload)
}));

// engine.io가 /socket.io/ OPTIONS preflight를 직접 처리하므로(express 미들웨어보다 먼저),
// 리스너 배열 맨 앞에 붙여 PNA 헤더를 모든 응답(특히 socket.io preflight)에 보장한다.
httpServer.prependListener('request', (req, res) => {
  if (String(req.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
});

// 크롬 일부 버전은 WebSocket 핸드셰이크(101) 응답에서도 PNA 헤더를 확인하므로,
// 허용 오리진의 WS 핸드셰이크 응답에 헤더를 강제로 주입한다.
const PNA_HEADER = 'Access-Control-Allow-Private-Network: true';
httpServer.prependListener('upgrade', (req, socket) => {
  const origin = String(req.headers.origin || '');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    if (origin) log(`WS 핸드셰이크 거부 예상 - 허용되지 않은 오리진: ${origin}`);
    return;
  }

  const origWrite = socket.write.bind(socket);
  socket.write = (chunk, ...rest) => {
    if (typeof chunk === 'string' && chunk.startsWith('HTTP/1.1 101')) {
      const [head, ...tail] = chunk.split('\r\n');
      return origWrite([head, PNA_HEADER, ...tail].join('\r\n'), ...rest);
    }
    return origWrite(chunk, ...rest);
  };
});

function statusPayload() {
  return {
    state: serverState,
    username: desiredUsername,
    message: serverMessage,
    viewerCount,
    totalComments: stats.totalComments,
    lastCommentAt: stats.lastCommentAt,
    reconnects: stats.reconnects,
    hasEulerApiKey: Boolean(EULER_API_KEY)
  };
}

function setState(state, message) {
  serverState = state;
  if (message !== undefined) serverMessage = message;
  io.emit('tiktok:status', statusPayload());
  log(`상태 -> ${state}${message ? ` (${message})` : ''}`);
}

io.on('connection', (socket) => {
  log(`웹앱 클라이언트 연결 (${socket.id}, 총 ${io.engine.clientsCount})`);
  socket.emit('tiktok:status', statusPayload());

  socket.on('collect:start', async (payload) => {
    const raw = payload && payload.username;
    const target = normalizeUsername(raw);
    if (!target) {
      socket.emit('tiktok:status', { ...statusPayload(), state: 'error', message: '틱톡 ID가 비어 있습니다.' });
      return;
    }

    if (
      target === desiredUsername &&
      connection &&
      (serverState === 'collecting' || serverState === 'connecting' || serverState === 'waiting_live')
    ) {
      socket.emit('tiktok:status', statusPayload());
      return;
    }

    await startCollecting(target);
  });

  socket.on('collect:stop', () => {
    stopCollecting();
  });

  socket.on('print:sale', (payload, acknowledge) => {
    const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
    sendPrintToHelper(payload || {}, reply);
  });

  socket.on('disconnect', () => {
    log(`웹앱 클라이언트 연결 해제 (${socket.id}, 총 ${io.engine.clientsCount})`);
    // 모든 브라우저가 떠나면 틱톡 연결도 정리해 Euler 한도를 아낀다.
    if (io.engine.clientsCount === 0 && connection) {
      log('브라우저가 없어 틱톡 연결을 정리합니다.');
      stopCollecting(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TikTok 수집 로직
// ---------------------------------------------------------------------------
function teardownConnection() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (connection) {
    try {
      connection.removeAllListeners();
      void connection.disconnect();
    } catch (_) { /* 무시 */ }
    connection = null;
  }
}

async function startCollecting(username) {
  manualStop = false;
  streamEnded = false;
  reconnectAttempts = 0;
  desiredUsername = username;
  stats.startedAt = new Date().toISOString();
  stats.totalComments = 0;
  viewerCount = 0;

  await connectTikTok(username);
}

function stopCollecting(silentWhenNoBrowser = false) {
  manualStop = true;
  teardownConnection();
  desiredUsername = '';
  viewerCount = 0;
  if (!silentWhenNoBrowser) {
    setState('idle', '수집 중지됨');
  } else {
    serverState = 'idle';
    serverMessage = '대기 중';
  }
}

function scheduleReconnect(reasonLabel) {
  if (manualStop || streamEnded) return;
  reconnectAttempts += 1;
  stats.reconnects += 1;
  const delay = Math.min(30000, 3000 * Math.pow(2, Math.min(reconnectAttempts - 1, 4)));
  log(`${reasonLabel} -> ${Math.round(delay / 1000)}초 후 재접속 시도 (${reconnectAttempts}회째)`);
  setState(serverState === 'waiting_live' ? 'waiting_live' : 'connecting', `${reasonLabel} · ${Math.round(delay / 1000)}초 후 자동 재시도`);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!manualStop && !streamEnded && desiredUsername) {
      void connectTikTok(desiredUsername);
    }
  }, delay);
}

function classifyConnectError(err) {
  const name = (err && err.name) || '';
  const msg = String((err && err.message) || err || '');
  if (name === 'UserOfflineError' || /offline|not\s*(currently\s*)?live|isn'?t\s*live/i.test(msg)) {
    return 'OFFLINE';
  }
  if (name === 'SignError' || /sign|euler|403|429/i.test(msg)) {
    return 'SIGN';
  }
  if (/room\s*id|resolve/i.test(msg)) {
    return 'ROOM';
  }
  return 'UNKNOWN';
}

async function connectTikTok(username) {
  teardownConnection();

  setState('connecting', `@${username} 라이브 연결 중...`);
  log(`틱톡 연결 시도: @${username}`);

  const nextConnection = new TikTokLiveConnection(username, EULER_API_KEY ? { signApiKey: EULER_API_KEY } : {});
  connection = nextConnection;

  nextConnection.on(WebcastEvent.CHAT, (data) => {
    if (!data) return;
    // v2.4.x protobuf 페이로드: 댓글 본문은 content, 계정 핸들은 user.displayId 다.
    const comment = String(data.content != null ? data.content : data.comment != null ? data.comment : '').trim();
    if (!comment) return;
    const user = data.user || {};
    stats.totalComments += 1;
    stats.lastCommentAt = new Date().toISOString();

    io.emit('comment:new', {
      id: String((data.common && data.common.msgId) || `${Date.now()}-${stats.totalComments}`),
      uniqueId: String(user.displayId || user.uniqueId || ''),
      nickname: String(user.nickname || user.displayId || user.uniqueId || '알 수 없음'),
      userId: user.id != null ? String(user.id) : undefined,
      content: comment,
      receivedAt: new Date().toISOString()
    });
  });

  nextConnection.on(WebcastEvent.ROOM_USER, (data) => {
    const count = Number((data && (data.total ?? data.viewerCount)) || 0);
    if (Number.isFinite(count) && count >= 0) {
      viewerCount = count;
      io.emit('tiktok:stats', statusPayload());
    }
  });

  nextConnection.on(WebcastEvent.STREAM_END, () => {
    log('틱톡 방송이 종료되었습니다.');
    streamEnded = true;
    teardownConnection();
    setState('ended', '방송이 종료되었습니다');
  });

  nextConnection.on(WebcastEvent.ERROR, (info) => {
    log('틱톡 이벤트 오류:', info && info.exception ? info.exception : info);
  });

  try {
    await nextConnection.connect();
    reconnectAttempts = 0;
    setState('collecting', `@${username} 댓글 실시간 수집 중`);
    log(`연결 성공: @${username}`);
  } catch (err) {
    const kind = classifyConnectError(err);
    const detail = String((err && err.message) || err || '');

    if (kind === 'OFFLINE') {
      setState('waiting_live', `@${username} 방송 대기 중... (주기적으로 확인)`);
      scheduleReconnect('방송 오프라인');
      return;
    }
    if (kind === 'SIGN') {
      setState('error', `서명 오류 - Euler Stream API 키/한도를 확인하세요 (${detail.slice(0, 80)})`);
      scheduleReconnect('서명 오류');
      return;
    }
    if (kind === 'ROOM') {
      setState('error', `방 ID 확인 실패 - 틱톡 ID를 확인하세요 (${detail.slice(0, 80)})`);
      scheduleReconnect('방 ID 오류');
      return;
    }
    setState('error', `연결 실패: ${detail.slice(0, 100)}`);
    scheduleReconnect('연결 오류');
  }
}

// ---------------------------------------------------------------------------
// 기동
// ---------------------------------------------------------------------------
httpServer.listen(PORT, HOST, () => {
  log(`VoiceCAP 댓글 수집 서버 기동: http://${HOST}:${PORT}`);
  log(`허용 오리진: ${[...ALLOWED_ORIGINS].join(', ')}`);
  log(`voicecapSMS 브리지: ${SMS_BRIDGE_API_KEY ? 'API 키 인증 사용' : 'API 키 없음 (로컬 개발 전용)'}`);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  log('종료 신호 수신 - 정리 중...');
  stopCollecting(true);
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
