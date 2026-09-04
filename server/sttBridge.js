/**
 * VoiceCAP Offline Local STT Bridge
 * Python faster-whisper 워커 프로세스를 관리하고 Socket.IO / REST API를 통해
 * 웹앱과 실시간 음성인식 스트리밍을 중계합니다.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

// ---------------------------------------------------------------------------
// Python 실행 경로 탐색
// ---------------------------------------------------------------------------
function resolvePythonPath() {
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }

  // 사용자 환경에 설치된 Python venv 경로 우선 탐색
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'),
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    'python'
  ];

  for (const p of candidates) {
    try {
      if (p === 'python' || fs.existsSync(p)) {
        return p;
      }
    } catch (_) {}
  }
  return 'python';
}

class SttBridge {
  constructor() {
    this.workerProcess = null;
    this.pythonPath = resolvePythonPath();
    this.workerScript = path.join(__dirname, 'stt_worker.py');
    this.io = null;
    this.isStarting = false;
    this.reconnectTimer = null;

    this.state = {
      available: false,
      state: 'DISCONNECTED', // DISCONNECTED | LOADING | READY | LISTENING | ERROR
      model: 'base',
      device: 'cpu',
      computeType: 'int8',
      message: '로컬 STT 초기화 대기 중',
      error: null,
      activeSessionId: '',
      activeGeneration: 0
    };
  }

  init(io) {
    this.io = io;
    this.startWorker();
    this.bindSocketEvents();
  }

  getStatus() {
    return {
      ...this.state,
      pythonPath: this.pythonPath
    };
  }

  sendToWorker(payload) {
    if (!this.workerProcess || !this.workerProcess.stdin || this.workerProcess.killed) {
      return false;
    }
    try {
      this.workerProcess.stdin.write(JSON.stringify(payload) + '\n');
      return true;
    } catch (err) {
      console.error('[SttBridge] 워커 stdin 전송 실패:', err);
      return false;
    }
  }

  startWorker() {
    if (this.workerProcess) return;
    if (!fs.existsSync(this.workerScript)) {
      this.state.state = 'ERROR';
      this.state.message = 'stt_worker.py 스크립트 파일을 찾을 수 없습니다.';
      return;
    }

    this.isStarting = true;
    this.state.state = 'LOADING';
    this.state.message = 'faster-whisper 워커 프로세스 시작 중...';
    this.broadcastStatus();

    try {
      console.log(`[SttBridge] Python 워커 실행: ${this.pythonPath} ${this.workerScript}`);
      this.workerProcess = spawn(this.pythonPath, [this.workerScript], {
        cwd: __dirname,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const rl = readline.createInterface({
        input: this.workerProcess.stdout,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => this.handleWorkerMessage(line));

      this.workerProcess.stderr.on('data', (chunk) => {
        const errText = chunk.toString('utf8').trim();
        if (errText) {
          console.warn('[SttBridge:WorkerStderr]', errText);
        }
      });

      this.workerProcess.on('close', (code) => {
        console.warn(`[SttBridge] 워커 프로세스 종료됨 (exit code: ${code})`);
        this.workerProcess = null;
        this.state.state = 'DISCONNECTED';
        this.state.message = `STT 워커가 종료되었습니다 (코드: ${code})`;
        this.broadcastStatus();

        // 3초 후 자동 재시작 시도 (개발/운영 지속성)
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (!this.workerProcess) {
            this.startWorker();
          }
        }, 3000);
      });

      this.workerProcess.on('error', (err) => {
        console.error('[SttBridge] 워커 스폰 에러:', err);
        this.state.state = 'ERROR';
        this.state.error = err.message;
        this.state.message = `Python 실행 실패: ${err.message}`;
        this.broadcastStatus();
      });
    } catch (err) {
      console.error('[SttBridge] 워커 시작 예외:', err);
      this.state.state = 'ERROR';
      this.state.error = err.message;
      this.broadcastStatus();
    }
  }

  handleWorkerMessage(line) {
    if (!line || !line.trim()) return;
    try {
      const msg = JSON.parse(line);
      const event = msg.event;

      if (event === 'started') {
        this.state.available = !!msg.has_faster_whisper;
      } else if (event === 'status') {
        this.state.state = msg.state || this.state.state;
        if (msg.model) this.state.model = msg.model;
        if (msg.device) this.state.device = msg.device;
        if (msg.compute_type) this.state.computeType = msg.compute_type;
        if (msg.message) this.state.message = msg.message;
        this.broadcastStatus();
      } else if (event === 'transcript') {
        if (this.io) {
          this.io.emit('stt:transcript', msg);
        }
      } else if (event === 'error') {
        this.state.error = msg.message;
        this.broadcastStatus();
        if (this.io) {
          this.io.emit('stt:error', msg);
        }
      } else if (event === 'listening_started') {
        this.state.state = 'LISTENING';
        this.state.activeSessionId = msg.session_id;
        this.state.activeGeneration = msg.generation;
        this.broadcastStatus();
      } else if (event === 'listening_stopped') {
        this.state.state = 'READY';
        this.state.activeSessionId = '';
        this.broadcastStatus();
      }
    } catch (e) {
      console.warn('[SttBridge] JSON 파싱 실패 라인:', line);
    }
  }

  broadcastStatus() {
    if (this.io) {
      this.io.emit('stt:status', this.getStatus());
    }
  }

  bindSocketEvents() {
    if (!this.io) return;

    this.io.on('connection', (socket) => {
      // 접속 시 즉시 최신 STT 상태 전송
      socket.emit('stt:status', this.getStatus());

      // 1. 상태 질의
      socket.on('stt:get_status', () => {
        socket.emit('stt:status', this.getStatus());
      });

      // 2. 모델 로드 요청
      socket.on('stt:load_model', (data) => {
        const model = (data && data.model) || 'base';
        const device = (data && data.device) || 'cpu';
        const computeType = (data && data.computeType) || 'int8';
        this.sendToWorker({
          cmd: 'load_model',
          model,
          device,
          compute_type: computeType
        });
      });

      // 3. 청취 시작
      socket.on('stt:start', (data) => {
        this.sendToWorker({
          cmd: 'start',
          session_id: data.sessionId,
          generation: data.generation,
          prompt: data.prompt || ''
        });
      });

      // 4. 오디오 청크 수신 (바이너리 Buffer 또는 Base64)
      socket.on('stt:audio', (payload) => {
        let b64 = '';
        if (Buffer.isBuffer(payload)) {
          b64 = payload.toString('base64');
        } else if (payload instanceof ArrayBuffer) {
          b64 = Buffer.from(payload).toString('base64');
        } else if (payload && payload.data) {
          b64 = payload.data;
        }

        if (b64) {
          this.sendToWorker({
            cmd: 'audio',
            data: b64
          });
        }
      });

      // 5. 청취 중지
      socket.on('stt:stop', (data) => {
        this.sendToWorker({
          cmd: 'stop',
          session_id: (data && data.sessionId) || ''
        });
      });
    });
  }

  destroy() {
    clearTimeout(this.reconnectTimer);
    if (this.workerProcess) {
      try {
        this.workerProcess.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
      } catch (_) {}
      try {
        this.workerProcess.kill();
      } catch (_) {}
      this.workerProcess = null;
    }
  }
}

const sttBridge = new SttBridge();

module.exports = {
  sttBridge,
  setupSttBridge: (io) => sttBridge.init(io)
};
