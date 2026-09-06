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
    '- **DirectX 12 / Vulkan GPU 가속 백엔드(whisper.cpp Vulkan 연동) 신규 탑재**: AMD 라데온(RX 6800 XT 등 16GB VRAM) 및 DirectX 12 / Vulkan 지원 그래픽카드에서 100% 네이티브 GPU 가속 완벽 지원',
    '- **large-v3-turbo 모델 선택 시 Vulkan GPU 초고속 실시간 연산**: AMD 환경에서 large-v3-turbo 모델을 16GB VRAM에 상주시켜 0.2~0.4초대 초고속 전사 (CPU 대비 15~20배 속도 향상, 오디오 청크 유실 0개 달성)',
    '- **하이브리드 듀얼 GPU 가속 엔진**: NVIDIA 환경은 CUDA 12 Tensor Core FP16 가속, AMD 및 범용 환경은 DirectX 12 / Vulkan GPU 가속 자동 선택',
    '- **오프라인 STT 로딩 무한 반복 방지 및 에러 복구 강화**: 상태 동기화 및 무한 재시작 방지 루프 차단기 적용',
    '- **도우미 및 웹앱 UI 연동**: ⚡ AMD Radeon RX 6800 XT (Vulkan GPU 가속) 배지 및 실시간 상태 동기화'
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
