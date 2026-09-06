/**
 * VoiceCAP Vulkan STT Runner (whisper.cpp Vulkan Backend)
 * 
 * AMD 라데온(DirectX 12 / Vulkan) 및 범용 GPU 가속 지원.
 * whisper-server.exe를 로컬 데몬(포트 2139)으로 구동하고,
 * 실시간 VAD 감지 오디오 세그먼트를 HTTP /inference 엔드포인트로 초고속 전사합니다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execSync } = require('child_process');

const VULKAN_PORT = 2139;
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE; // 32000 bytes/s

// VAD & 버퍼링 상수
const SILENCE_RMS_THRESHOLD = 0.012;
const MIN_SPEECH_DURATION_SEC = 0.45;
const MIN_SILENCE_DURATION_SEC = 0.45;
const MAX_SPEECH_BUFFER_SEC = 6.0;
const PRE_ROLL_BUFFER_SEC = 0.25;
const PRE_ROLL_BYTES = Math.floor(BYTES_PER_SEC * PRE_ROLL_BUFFER_SEC); // 8000 bytes

const MODEL_FILENAMES = {
  'tiny': 'ggml-tiny.bin',
  'base': 'ggml-base.bin',
  'small': 'ggml-small.bin',
  'medium': 'ggml-medium.bin',
  'large': 'ggml-large-v3-turbo.bin',
  'large-v3-turbo': 'ggml-large-v3-turbo.bin',
  'large-v3': 'ggml-large-v3.bin'
};

function getModelsDir() {
  const baseDir = process.env.LOCALAPPDATA || process.env.APPDATA || os.tmpdir();
  const dir = path.join(baseDir, 'voicecap-comment-helper', 'models');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

function resolveVulkanBinDir() {
  const defaultPath = path.join(__dirname, 'bin', 'whisper-vulkan');
  if (defaultPath.includes('app.asar')) {
    const unpacked = defaultPath.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(path.join(unpacked, 'whisper-server.exe'))) {
      return unpacked;
    }
  }

  const candidates = [
    defaultPath,
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'server', 'bin', 'whisper-vulkan'),
    path.join(process.resourcesPath || '', 'bin', 'whisper-vulkan'),
    path.join(process.resourcesPath || '', 'server', 'bin', 'whisper-vulkan'),
    path.join(process.env.LOCALAPPDATA || '', 'voicecap-comment-helper', 'bin', 'whisper-vulkan'),
    path.join(__dirname, '..', 'scratch', 'whisper-vulkan')
  ];

  for (const c of candidates) {
    if (c.includes('app.asar')) continue; // Windows spawn cannot execute from inside asar
    if (fs.existsSync(path.join(c, 'whisper-server.exe'))) {
      return c;
    }
  }
  return defaultPath;
}

function calculateRms(pcmBuffer) {
  if (!pcmBuffer || pcmBuffer.length < 2) return 0.0;
  const numSamples = Math.floor(pcmBuffer.length / 2);
  let sumSq = 0;
  let count = 0;
  // 속도를 위해 8샘플(16바이트) 단위로 서브샘플링
  for (let i = 0; i < pcmBuffer.length - 1; i += 16) {
    const sample = pcmBuffer.readInt16LE(i) / 32768.0;
    sumSq += sample * sample;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0.0;
}

function createWavBuffer(pcmBuffer, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const dataLen = pcmBuffer.length;
  const fileLen = dataLen + 36;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(fileLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcmBuffer]);
}

class VulkanRunner {
  constructor() {
    this.serverProcess = null;
    this.currentModelName = '';
    this.currentModelPath = '';
    this.port = VULKAN_PORT;
    this.isRunning = false;
    this.isStarting = false;
    this.onTranscriptCallback = null;
    this.onErrorCallback = null;
    this.onStatusCallback = null;

    // VAD 및 오디오 버퍼링 상태
    this.activeSessionId = '';
    this.activeGeneration = 0;
    this.audioBuffer = [];
    this.preRollBuffer = [];
    this.speechDetected = false;
    this.silenceSamplesCount = 0;
    this.totalBufferedBytes = 0;
    this.preRollBytes = 0;
  }

  isAvailable() {
    const binDir = resolveVulkanBinDir();
    const serverExe = path.join(binDir, 'whisper-server.exe');
    const vulkanDll = path.join(binDir, 'ggml-vulkan.dll');
    return fs.existsSync(serverExe) && fs.existsSync(vulkanDll);
  }

  getModelPath(modelName) {
    const filename = MODEL_FILENAMES[modelName] || `ggml-${modelName}.bin`;
    const modelsDir = getModelsDir();
    return path.join(modelsDir, filename);
  }

  hasModel(modelName) {
    const p = this.getModelPath(modelName);
    return fs.existsSync(p) && fs.statSync(p).size > 10000000;
  }

  downloadModel(modelName, onProgress) {
    return new Promise((resolve, reject) => {
      const filename = MODEL_FILENAMES[modelName] || `ggml-${modelName}.bin`;
      const targetPath = path.join(getModelsDir(), filename);
      const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${filename}`;
      console.log(`[VulkanRunner] 모델 다운로드 시작: ${url} -> ${targetPath}`);

      const curl = spawn('curl.exe', ['-L', url, '-o', targetPath, '--progress-bar'], {
        windowsHide: true
      });

      curl.stderr.on('data', (d) => {
        const text = d.toString('utf8');
        if (onProgress) onProgress(text);
      });

      curl.on('close', (code) => {
        if (code === 0 && fs.existsSync(targetPath) && fs.statSync(targetPath).size > 10000000) {
          console.log(`[VulkanRunner] 모델 다운로드 완료: ${targetPath}`);
          resolve(targetPath);
        } else {
          reject(new Error(`모델 다운로드 실패 (code: ${code})`));
        }
      });

      curl.on('error', (err) => reject(err));
    });
  }

  async ensureModel(modelName, onProgress) {
    if (this.hasModel(modelName)) {
      return this.getModelPath(modelName);
    }
    return await this.downloadModel(modelName, onProgress);
  }

  async start(modelName = 'large-v3-turbo', onStatus) {
    if (this.isRunning && this.currentModelName === modelName) {
      console.log(`[VulkanRunner] 모델(${modelName})이 이미 Vulkan 데몬에 로드되어 있습니다.`);
      return true;
    }

    if (this.serverProcess) {
      this.stop();
      await new Promise(r => setTimeout(r, 500));
    }

    this.isStarting = true;
    if (onStatus) onStatus({ state: 'LOADING', message: `Vulkan 모델 (${modelName}) 준비 중...` });

    const modelPath = await this.ensureModel(modelName, (p) => {
      if (onStatus) onStatus({ state: 'LOADING', message: `Vulkan 모델 다운로드 중...` });
    });

    const binDir = resolveVulkanBinDir();
    const serverExe = path.join(binDir, 'whisper-server.exe');

    console.log(`[VulkanRunner] whisper-server 실행: ${serverExe} -m ${modelPath} --port ${this.port}`);

    const args = [
      '-m', modelPath,
      '--host', '127.0.0.1',
      '--port', String(this.port),
      '-l', 'ko',
      '--language', 'ko',
      '-t', '4',
      '--no-timestamps'
    ];

    this.serverProcess = spawn(serverExe, args, {
      cwd: binDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.serverProcess.stdout.on('data', (d) => {
      const line = d.toString('utf8');
      if (line.includes('HTTP server listening') || line.includes('Vulkan0')) {
        console.log('[VulkanRunner:stdout]', line.trim());
      }
    });

    this.serverProcess.stderr.on('data', (d) => {
      const err = d.toString('utf8');
      if (err.includes('error') || err.includes('failed')) {
        console.warn('[VulkanRunner:stderr]', err.trim());
      }
    });

    this.serverProcess.on('close', (code) => {
      console.warn(`[VulkanRunner] whisper-server 프로세스 종료 (code: ${code})`);
      this.isRunning = false;
      this.serverProcess = null;
    });

    this.serverProcess.on('error', (err) => {
      console.error('[VulkanRunner] whisper-server 실행 오류:', err);
      this.isRunning = false;
      this.serverProcess = null;
    });

    // 서버 준비 여부 확인 (최대 15초 폴링)
    const startTime = Date.now();
    let ready = false;
    while (Date.now() - startTime < 15000) {
      await new Promise(r => setTimeout(r, 400));
      if (!this.serverProcess) break;
      const isListening = await this.checkHealth();
      if (isListening) {
        ready = true;
        break;
      }
    }

    this.isStarting = false;
    if (ready) {
      this.isRunning = true;
      this.currentModelName = modelName;
      this.currentModelPath = modelPath;
      console.log(`[VulkanRunner] whisper-server 준비 완료 (Vulkan GPU 가속, 포트 ${this.port})`);
      if (onStatus) {
        onStatus({
          state: 'READY',
          model: modelName,
          device: 'vulkan',
          compute_type: 'float16',
          message: `로컬 STT 준비 완료 (${modelName} / Vulkan GPU 가속)`
        });
      }
      return true;
    } else {
      this.stop();
      throw new Error('whisper-server Vulkan 데몬 시작 시간 초과 또는 실패');
    }
  }

  checkHealth() {
    return new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port: this.port,
        path: '/',
        method: 'GET',
        timeout: 1000
      }, (res) => {
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  stop() {
    this.isRunning = false;
    this.isStarting = false;
    this.currentModelName = '';
    this.resetAudioBuffer();
    if (this.serverProcess) {
      try {
        this.serverProcess.kill('SIGKILL');
      } catch (_) {}
      this.serverProcess = null;
    }
  }

  resetAudioBuffer() {
    this.audioBuffer = [];
    this.preRollBuffer = [];
    this.speechDetected = false;
    this.silenceSamplesCount = 0;
    this.totalBufferedBytes = 0;
    this.preRollBytes = 0;
  }

  startListening(sessionId, generation) {
    this.activeSessionId = sessionId;
    this.activeGeneration = generation;
    this.resetAudioBuffer();
  }

  stopListening() {
    this.activeSessionId = '';
    this.resetAudioBuffer();
  }

  /**
   * 들어온 PCM 청크를 VAD 기반으로 버퍼링하고 발화 단위 완료 시 자동 추론
   */
  processAudioChunk(pcmBuffer, sessionId, generation) {
    if (!this.isRunning || !pcmBuffer || pcmBuffer.length === 0) return;
    if (sessionId !== this.activeSessionId) return;

    const rms = calculateRms(pcmBuffer);
    const chunkLen = pcmBuffer.length;
    const isSpeech = rms >= SILENCE_RMS_THRESHOLD;

    if (isSpeech) {
      if (!this.speechDetected) {
        // 발화 시작: 프리롤 버퍼 결합하여 첫 자음 복원
        this.speechDetected = true;
        this.silenceSamplesCount = 0;
        this.audioBuffer = [...this.preRollBuffer, pcmBuffer];
        this.totalBufferedBytes = this.preRollBytes + chunkLen;
        this.preRollBuffer = [];
        this.preRollBytes = 0;
      } else {
        // 발화 지속
        this.audioBuffer.push(pcmBuffer);
        this.totalBufferedBytes += chunkLen;
        this.silenceSamplesCount = 0;
      }
    } else {
      if (!this.speechDetected) {
        // 비발화 상태: 최신 250ms 프리롤 유지
        this.preRollBuffer.push(pcmBuffer);
        this.preRollBytes += chunkLen;
        while (this.preRollBytes > PRE_ROLL_BYTES && this.preRollBuffer.length > 1) {
          const removed = this.preRollBuffer.shift();
          this.preRollBytes -= removed.length;
        }
      } else {
        // 발화 후 무음 진입
        this.audioBuffer.push(pcmBuffer);
        this.totalBufferedBytes += chunkLen;
        this.silenceSamplesCount += chunkLen;

        const silenceDurationSec = this.silenceSamplesCount / BYTES_PER_SEC;
        const totalDurationSec = this.totalBufferedBytes / BYTES_PER_SEC;

        // 450ms 무음 지속 시 또는 6초 최대 버퍼 초과 시 플러시
        if (silenceDurationSec >= MIN_SILENCE_DURATION_SEC || totalDurationSec >= MAX_SPEECH_BUFFER_SEC) {
          if (totalDurationSec >= MIN_SPEECH_DURATION_SEC) {
            const fullPcm = Buffer.concat(this.audioBuffer);
            this.flushSpeechSegment(fullPcm, sessionId, generation);
          }
          this.resetAudioBuffer();
        }
      }
    }
  }

  async flushSpeechSegment(pcmBuffer, sessionId, generation) {
    const duration = pcmBuffer.length / BYTES_PER_SEC;
    const startTime = Date.now();

    try {
      const text = await this.transcribePcm(pcmBuffer);
      const inferTime = (Date.now() - startTime) / 1000;

      if (text && text.trim()) {
        const cleanText = text.trim().replace(/^\[.*?\]\s*/g, '');
        if (cleanText && this.onTranscriptCallback) {
          this.onTranscriptCallback({
            event: 'transcript',
            session_id: sessionId,
            generation: generation,
            text: cleanText,
            is_final: true,
            confidence: 0.95,
            provider: 'VULKAN_WHISPER',
            duration: Math.round(duration * 100) / 100,
            infer_time: Math.round(inferTime * 1000) / 1000
          });
        }
      }
    } catch (err) {
      console.warn('[VulkanRunner] 세그먼트 전사 실패:', err.message);
    }
  }

  transcribePcm(pcmBuffer) {
    return new Promise((resolve, reject) => {
      const wavBuffer = createWavBuffer(pcmBuffer);
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

      const postDataParts = [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
        wavBuffer,
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n--${boundary}--\r\n`)
      ];

      const fullPayload = Buffer.concat(postDataParts);

      const req = http.request({
        host: '127.0.0.1',
        port: this.port,
        path: '/inference',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': fullPayload.length
        },
        timeout: 10000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk.toString('utf8'));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.text || '');
          } catch (_) {
            resolve(body.trim());
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Vulkan 추론 요청 시간 초과'));
      });

      req.write(fullPayload);
      req.end();
    });
  }
}

const vulkanRunner = new VulkanRunner();

module.exports = {
  VulkanRunner,
  vulkanRunner
};
