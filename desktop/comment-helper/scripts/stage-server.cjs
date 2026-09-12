const fs = require('fs');
const path = require('path');

const helperRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(helperRoot, '..', '..');
const sourceServer = path.join(repoRoot, 'server');
const targetServer = path.join(helperRoot, 'server');
const runtimeDir = path.join(helperRoot, 'build-runtime');

const serverFiles = ['index.js', 'bridgeApi.js', 'bridgeStore.js', 'sttBridge.js', 'stt_worker.py', 'vulkanRunner.js', 'cloudCommentPublisher.js', 'printJobStore.js', 'cloudPrintWorker.js'];

fs.rmSync(targetServer, { recursive: true, force: true });
fs.mkdirSync(targetServer, { recursive: true });

const releaseDir = path.join(helperRoot, 'release');
try {
  if (fs.existsSync(releaseDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
} catch (_) {}

for (const filename of serverFiles) {
  const src = path.join(sourceServer, filename);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(targetServer, filename));
  }
}

// whisper-vulkan 바이너리 및 DLL 스테이징
const sourceBin = path.join(sourceServer, 'bin');
const targetBin = path.join(targetServer, 'bin');
if (fs.existsSync(sourceBin)) {
  fs.cpSync(sourceBin, targetBin, { recursive: true });
}

// React 웹 프론트엔드 dist 스테이징
const sourceDist = path.join(repoRoot, 'dist');
const targetDist = path.join(helperRoot, 'dist');
const targetServerDist = path.join(targetServer, 'dist');
if (fs.existsSync(sourceDist)) {
  fs.rmSync(targetDist, { recursive: true, force: true });
  fs.cpSync(sourceDist, targetDist, { recursive: true });
  fs.rmSync(targetServerDist, { recursive: true, force: true });
  fs.cpSync(sourceDist, targetServerDist, { recursive: true });
  console.log('[stage] VoiceCAP 웹 dist 산출물 복사 완료');
} else {
  console.warn('[stage] 경고: repoRoot/dist 폴더가 없습니다. npm run build를 먼저 실행하세요.');
}

fs.mkdirSync(runtimeDir, { recursive: true });

let eulerApiKey = String(process.env.EULERSTREAM_API_KEY || '').trim();
const keyPath = path.join(repoRoot, 'eulerstream_key.txt');
if (!eulerApiKey && fs.existsSync(keyPath)) {
  eulerApiKey = fs.readFileSync(keyPath, 'utf8').trim();
}

// 댓글 서버는 기존 실행 방식과 동일하게 server/eulerstream_key.txt를 우선 읽는다.
// 이 폴더는 빌드 산출물 전용이며 .gitignore에 포함되어 저장소에는 비밀키가 올라가지 않는다.
const stagedKeyPath = path.join(targetServer, 'eulerstream_key.txt');
if (eulerApiKey) {
  fs.writeFileSync(stagedKeyPath, `${eulerApiKey}\n`, 'utf8');
} else {
  fs.rmSync(stagedKeyPath, { force: true });
}

fs.writeFileSync(
  path.join(runtimeDir, 'runtime-config.json'),
  `${JSON.stringify({ eulerApiKey }, null, 2)}\n`,
  'utf8'
);

console.log(`[stage] 댓글 서버 파일 ${serverFiles.length}개 준비 완료`);
console.log(`[stage] Euler Stream API 키: ${eulerApiKey ? '설치 파일에 포함됨' : '없음 (커뮤니티 모드)'}`);
