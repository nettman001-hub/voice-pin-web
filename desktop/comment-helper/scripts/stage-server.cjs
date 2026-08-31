const fs = require('fs');
const path = require('path');

const helperRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(helperRoot, '..', '..');
const sourceServer = path.join(repoRoot, 'server');
const targetServer = path.join(helperRoot, 'server');
const runtimeDir = path.join(helperRoot, 'build-runtime');

const serverFiles = ['index.js', 'bridgeApi.js', 'bridgeStore.js'];

fs.rmSync(targetServer, { recursive: true, force: true });
fs.mkdirSync(targetServer, { recursive: true });

for (const filename of serverFiles) {
  fs.copyFileSync(path.join(sourceServer, filename), path.join(targetServer, filename));
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
