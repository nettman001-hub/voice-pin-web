/**
 * VoiceCAP Offline Local STT Bridge
 * Python faster-whisper 워커 프로세스를 관리하고 Socket.IO / REST API를 통해
 * 웹앱과 실시간 음성인식 스트리밍을 중계합니다.
 * 
 * [개선 반영 (OFFLINE_STT_DIAGNOSIS_REPORT)]:
 * 1. requestedModel vs loadedModel 명시적 분리 및 상태 동기화
 * 2. 에러 상태 전파(state='ERROR') 및 복구 시 에러 초기화
 * 3. 청취 세션 소유권(ownerSocketId) 검증으로 타 탭/클라이언트 간섭 차단
 * 4. 소유 소켓 연결 끊김 시 자동 청취 중지(고아 세션 방지)
 * 5. stdin backpressure 모니터링 (큐 과부하 시 안전 프레임 드롭)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const readline = require('readline');

function getSttSettingsPath() {
  const baseDir = process.env.APPDATA || process.env.LOCALAPPDATA || os.tmpdir();
  return path.join(baseDir, 'voicecap-comment-helper', 'stt-settings.json');
}

function readSttSettings() {
  try {
    const p = getSttSettingsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveSttSettings(settings) {
  try {
    const p = getSttSettingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const existing = readSttSettings();
    fs.writeFileSync(p, JSON.stringify({ ...existing, ...settings }, null, 2), 'utf8');
  } catch (_) {}
}

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

function resolveWorkerScript() {
  const defaultPath = path.join(__dirname, 'stt_worker.py');
  if (defaultPath.includes('app.asar')) {
    // 1. electron-builder asarUnpack 경로 우선 확인
    const unpacked = defaultPath.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) {
      return unpacked;
    }
    // 2. app.asar 내부에서 실제 디스크 폴더로 복사
    try {
      const targetDir = path.join(
        process.env.APPDATA || process.env.LOCALAPPDATA || os.tmpdir(),
        'voicecap-comment-helper',
        'stt'
      );
      fs.mkdirSync(targetDir, { recursive: true });
      const targetFile = path.join(targetDir, 'stt_worker.py');
      fs.writeFileSync(targetFile, fs.readFileSync(defaultPath));
      return targetFile;
    } catch (e) {
      console.warn('[SttBridge] stt_worker.py 추출 경고:', e.message);
    }
  }
  return defaultPath;
}

class SttBridge {
  constructor() {
    this.workerProcess = null;
    this.pythonPath = resolvePythonPath();
    this.workerScript = resolveWorkerScript();
    this.io = null;
    this.isStarting = false;
    this.reconnectTimer = null;
    this.ownerSocketId = null;
    this.droppedChunksCount = 0;

    const saved = readSttSettings();

    this.state = {
      available: false,
      state: 'DISCONNECTED', // DISCONNECTED | LOADING | READY | LISTENING | ERROR
      requestedModel: saved.model || 'base',
      model: saved.model || 'base',
      device: saved.device || 'cuda', // 기본적으로 GPU(CUDA) 우선 시도
      computeType: saved.computeType || (saved.device === 'cpu' ? 'int8' : 'float16'),
      message: '로컬 STT 초기화 대기 중',
      error: null,
      activeSessionId: '',
      activeGeneration: 0,
      hasGpu: false,
      gpuName: '',
      availableDevices: [
        { id: 'cuda', name: 'NVIDIA CUDA GPU (가속 권장)', available: false, compute_type: 'float16' },
        { id: 'cpu', name: 'CPU (저전력/기본 연산)', available: true, compute_type: 'int8' }
      ]
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
      pythonPath: this.pythonPath,
      hasOwner: !!this.ownerSocketId,
      droppedChunks: this.droppedChunksCount
    };
  }

  sendToWorker(payload) {
    if (!this.workerProcess || !this.workerProcess.stdin || this.workerProcess.killed) {
      return false;
    }
    try {
      // stdin 버퍼 과부하(1.5MB 이상) 시 backpressure 방어: 오디오 청크인 경우 드롭
      if (payload.cmd === 'audio' && this.workerProcess.stdin.writableLength > 1500000) {
        this.droppedChunksCount += 1;
        if (this.droppedChunksCount % 20 === 1) {
          console.warn(`[SttBridge] 워커 추론 지연으로 오디오 청크 드롭 (누적 ${this.droppedChunksCount}개)`);
        }
        return false;
      }

      this.workerProcess.stdin.write(JSON.stringify(payload) + '\n');
      return true;
    } catch (err) {
      console.error('[SttBridge] 워커 stdin 전송 실패:', err);
      return false;
    }
  }

  startWorker() {
    if (this.workerProcess) return;
    this.workerScript = resolveWorkerScript();
    if (!fs.existsSync(this.workerScript)) {
      this.state.state = 'ERROR';
      this.state.message = 'stt_worker.py 스크립트 파일을 찾을 수 없습니다.';
      this.state.error = 'stt_worker.py 누락';
      this.broadcastStatus();
      return;
    }

    const workDir = path.dirname(this.workerScript);
    this.isStarting = true;
    this.state.state = 'LOADING';
    this.state.message = 'faster-whisper 워커 프로세스 시작 중...';
    this.broadcastStatus();

    try {
      console.log(`[SttBridge] Python 워커 실행: ${this.pythonPath} ${this.workerScript} (cwd: ${workDir})`);
      this.workerProcess = spawn(this.pythonPath, [this.workerScript], {
        cwd: workDir,
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
        this.ownerSocketId = null;
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
        this.ownerSocketId = null;
        this.state.state = 'ERROR';
        this.state.error = err.message;
        this.state.message = `Python 실행 실패: ${err.message}`;
        this.broadcastStatus();
      });
    } catch (err) {
      console.error('[SttBridge] 워커 시작 예외:', err);
      this.ownerSocketId = null;
      this.state.state = 'ERROR';
      this.state.error = err.message;
      this.broadcastStatus();
    }
  }

  updateDeviceInfo(deviceInfo) {
    if (!deviceInfo) return;
    this.state.hasGpu = Boolean(deviceInfo.cuda_available);
    this.state.gpuName = deviceInfo.device_name || '';
    if (Array.isArray(deviceInfo.devices)) {
      this.state.availableDevices = deviceInfo.devices;
    }
    const saved = readSttSettings();
    if (!saved.device && deviceInfo.cuda_available) {
      this.state.device = 'cuda';
      this.state.computeType = 'float16';
    }
  }

  handleWorkerMessage(line) {
    if (!line || !line.trim()) return;
    try {
      const msg = JSON.parse(line);
      const event = msg.event;

      if (event === 'started') {
        this.state.available = !!msg.has_faster_whisper;
        if (msg.device_info) this.updateDeviceInfo(msg.device_info);
        this.broadcastStatus();
      } else if (event === 'devices_detected') {
        this.updateDeviceInfo(msg);
        this.broadcastStatus();
      } else if (event === 'status') {
        this.state.state = msg.state || this.state.state;
        if (msg.model) {
          this.state.model = msg.model;
          this.state.requestedModel = msg.model;
        }
        if (msg.device) this.state.device = msg.device;
        if (msg.compute_type) this.state.computeType = msg.compute_type;
        if (msg.message) this.state.message = msg.message;
        if (msg.device_info) this.updateDeviceInfo(msg.device_info);
        if (msg.state === 'READY') {
          this.state.error = null;
          saveSttSettings({
            device: this.state.device,
            computeType: this.state.computeType,
            model: this.state.model
          });
        }
        this.broadcastStatus();
      } else if (event === 'transcript') {
        if (this.io) {
          this.io.emit('stt:transcript', msg);
        }
      } else if (event === 'error') {
        this.state.state = 'ERROR';
        this.state.error = msg.message || 'STT 워커 오류';
        this.state.message = msg.message || 'STT 워커 오류';
        this.broadcastStatus();
        if (this.io) {
          this.io.emit('stt:error', msg);
        }
      } else if (event === 'listening_started') {
        this.state.state = 'LISTENING';
        this.state.activeSessionId = msg.session_id;
        this.state.activeGeneration = msg.generation;
        if (msg.model) {
          this.state.model = msg.model;
          this.state.requestedModel = msg.model;
        }
        if (msg.device) this.state.device = msg.device;
        if (msg.compute_type) this.state.computeType = msg.compute_type;
        this.state.error = null;
        saveSttSettings({
          device: this.state.device,
          computeType: this.state.computeType,
          model: this.state.model
        });
        this.broadcastStatus();
        if (this.io) {
          this.io.emit('stt:listening_started', msg);
        }
      } else if (event === 'listening_stopped') {
        this.state.state = 'READY';
        this.state.activeSessionId = '';
        this.ownerSocketId = null;
        this.broadcastStatus();
        if (this.io) {
          this.io.emit('stt:listening_stopped', msg);
        }
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

      // 장치 감지 재요청
      socket.on('stt:detect_devices', () => {
        this.sendToWorker({ cmd: 'detect_devices' });
      });

      // 장치 설정 변경 (GPU <-> CPU)
      socket.on('stt:set_device', (data) => {
        const device = (data && data.device) || (this.state.hasGpu ? 'cuda' : 'cpu');
        const computeType = device === 'cuda' ? 'float16' : 'int8';
        this.state.device = device;
        this.state.computeType = computeType;
        saveSttSettings({ device, computeType, model: this.state.model });
        this.sendToWorker({
          cmd: 'load_model',
          model: this.state.model || 'base',
          device,
          compute_type: computeType
        });
        this.broadcastStatus();
      });

      // 2. 모델 로드 요청
      socket.on('stt:load_model', (data) => {
        const model = (data && data.model) || 'base';
        const device = (data && data.device) || this.state.device || 'cuda';
        const computeType = (data && data.computeType) || (device === 'cuda' ? 'float16' : 'int8');
        this.state.requestedModel = model;
        this.state.state = 'LOADING';
        this.state.message = `모델 (${model} / ${device === 'cuda' ? 'GPU' : 'CPU'}) 로딩 중...`;
        this.broadcastStatus();

        this.sendToWorker({
          cmd: 'load_model',
          model,
          device,
          compute_type: computeType
        });
      });

      // 3. 청취 시작 (소유권 등록)
      socket.on('stt:start', (data) => {
        // 이미 다른 활성 소켓이 청취 중인 경우 소유권 전환 허용
        this.ownerSocketId = socket.id;
        this.droppedChunksCount = 0;
        this.state.activeSessionId = data.sessionId;
        this.state.activeGeneration = data.generation;

        // 요청 모델이 지정되어 있고 현재 로드된 모델과 다르면 모델 로딩 요청 병행
        if (data.model && data.model !== this.state.model) {
          this.state.requestedModel = data.model;
          this.state.state = 'LOADING';
          this.state.message = `모델 (${data.model}) 로딩 중...`;
          this.broadcastStatus();

          this.sendToWorker({
            cmd: 'load_model',
            model: data.model,
            device: this.state.device || 'cuda',
            compute_type: this.state.computeType || (this.state.device === 'cpu' ? 'int8' : 'float16')
          });
        }

        this.sendToWorker({
          cmd: 'start',
          session_id: data.sessionId,
          generation: data.generation,
          prompt: data.prompt || ''
        });
      });

      // 4. 오디오 청크 수신 (소유 소켓 검증)
      socket.on('stt:audio', (payload) => {
        // 소유 소켓이 아직 등록되지 않았으면 현재 오디오를 보내는 소켓을 소유자로 등록
        if (!this.ownerSocketId) {
          this.ownerSocketId = socket.id;
        } else if (socket.id !== this.ownerSocketId) {
          return;
        }

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
            session_id: this.state.activeSessionId,
            generation: this.state.activeGeneration,
            data: b64
          });
        }
      });

      // 5. 청취 중지
      socket.on('stt:stop', (data) => {
        if (!this.ownerSocketId || socket.id === this.ownerSocketId) {
          this.sendToWorker({
            cmd: 'stop',
            session_id: (data && data.sessionId) || this.state.activeSessionId
          });
          this.ownerSocketId = null;
        }
      });

      // 6. 소켓 연결 해제 시 고아 세션 자동 정리
      socket.on('disconnect', () => {
        if (this.ownerSocketId && socket.id === this.ownerSocketId) {
          console.log('[SttBridge] 청취 소유 소켓 연결 끊김 -> 청취 자동 정지');
          this.sendToWorker({
            cmd: 'stop',
            session_id: this.state.activeSessionId
          });
          this.ownerSocketId = null;
        }
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
