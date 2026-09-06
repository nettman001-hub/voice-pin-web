const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGitHubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();

  try {
    const creds = execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n',
      encoding: 'utf8'
    });
    for (const line of creds.split('\n')) {
      if (line.startsWith('password=')) {
        return line.substring('password='.length).trim();
      }
    }
  } catch (err) {
    console.error('Git Credential Manager 토큰 조회 실패:', err.message);
  }
  return '';
}

async function main() {
  const token = getGitHubToken();
  if (!token) {
    console.error('GitHub 토큰을 찾을 수 없습니다.');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const version = pkg.version || '1.3.0';

  const owner = 'nettman001-hub';
  const repo = 'voice-pin-web';
  const tag = `comment-helper-v${version}`;
  const releaseName = `VoiceCAP 댓글 도우미 v${version}`;
  const releaseBody = [
    `### VoiceCAP 댓글 도우미 v${version}`,
    '',
    '- **오프라인 STT 로딩 무한 반복 현상 수정**: numpy 및 faster-whisper 임포트 예외 방어 및 반복 비정상 종료 시 무한 재시작 방지 루프 차단기 적용',
    '- **전용 독립 가상환경(venv) 자동 우선 인식**: `%LOCALAPPDATA%\\voicecap-comment-helper\\venv` 우선 탐색 및 검증',
    '- **하드웨어(GPU/CPU) 자동 감지 및 최적화**: NVIDIA RTX(Tensor Core FP16 가속), GTX(CUDA INT8 가속), AMD 라데온(CPU 멀티스레드 가속), 온보드 내장 그래픽 자동 판별 및 최적 모델 추천',
    '- **구형 GPU(GTX 1060 등) CUDA INT8 연산 가속**: 파스칼 세대 GPU의 연산 특성을 반영하여 GPU 가속 유지',
    '- **새 컴퓨터 원클릭 오프라인 STT 설치 스크립트 포함**: `setup-offline-stt.bat` 추가로 Python venv, faster-whisper, numpy, CUDA 라이브러리 자동 구성',
    '- **도우미 및 웹앱 UI 연동**: 감지된 그래픽카드 배지, 오류 상세 원인 표시 및 실시간 상태 표시'
  ].join('\n');

  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'VoiceCAP-Release-Uploader',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  console.log(`[1/4] 릴리스 확인 중: ${tag}`);
  let release = null;
  const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, { headers });
  if (getRes.ok) {
    release = await getRes.json();
    console.log(`기존 릴리스 발견: ID ${release.id}`);
  } else {
    console.log(`릴리스 생성 중: ${tag}`);
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: releaseName,
        body: releaseBody,
        draft: false,
        prerelease: false,
        make_latest: 'true'
      })
    });
    if (!createRes.ok) {
      const errBody = await createRes.text();
      throw new Error(`릴리스 생성 실패 (${createRes.status}): ${errBody}`);
    }
    release = await createRes.json();
    console.log(`릴리스 생성 완료: ID ${release.id}`);
  }

  const releaseDir = path.resolve(__dirname, '..', 'release');
  const batPath = path.resolve(__dirname, 'setup-offline-stt.bat');
  const filesToUpload = [
    { name: 'VoiceCAP-Comment-Helper-Setup.exe', path: path.join(releaseDir, 'VoiceCAP-Comment-Helper-Setup.exe'), type: 'application/octet-stream' },
    { name: 'latest.yml', path: path.join(releaseDir, 'latest.yml'), type: 'text/yaml' },
    { name: 'VoiceCAP-Comment-Helper-Setup.exe.blockmap', path: path.join(releaseDir, 'VoiceCAP-Comment-Helper-Setup.exe.blockmap'), type: 'application/octet-stream' },
    { name: 'setup-offline-stt.bat', path: batPath, type: 'application/x-bat' }
  ].filter(f => fs.existsSync(f.path));

  console.log(`[2/4] 업로드 대상 파일: ${filesToUpload.map(f => f.name).join(', ')}`);

  // 기존 릴리스에 이미 올라간 동일 파일이 있다면 먼저 삭제
  const existingAssets = release.assets || [];
  for (const fileObj of filesToUpload) {
    const matched = existingAssets.find(a => a.name === fileObj.name);
    if (matched) {
      console.log(`기존 에셋 삭제: ${fileObj.name} (ID: ${matched.id})`);
      await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${matched.id}`, {
        method: 'DELETE',
        headers
      });
    }
  }

  // 파일 업로드 진행
  console.log('[3/4] 파일 업로드 시작...');
  for (const fileObj of filesToUpload) {
    const filePath = fileObj.path;
    const filename = fileObj.name;
    const stat = fs.statSync(filePath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    console.log(`업로드 중: ${filename} (${sizeMb} MB)...`);

    const fileStream = fs.readFileSync(filePath);
    const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(filename)}`;

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': fileObj.type,
        'Content-Length': String(stat.size)
      },
      body: fileStream
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`에셋 업로드 실패 (${filename}, ${uploadRes.status}): ${errText}`);
    }
    const uploadedAsset = await uploadRes.json();
    console.log(`✅ 업로드 성공: ${filename} -> ${uploadedAsset.browser_download_url}`);
  }

  console.log('[4/4] 모든 파일 릴리스 등록 완료!');
  console.log(`릴리스 URL: ${release.html_url}`);
}

main().catch(err => {
  console.error('❌ 업로드 작업 중 오류 발생:', err);
  process.exit(1);
});
