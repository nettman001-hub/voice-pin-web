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
    '- **50x30mm 라벨 스티커 상단 여백 및 밀림 완벽 보정**: 상단 패딩을 8.5mm로 조정하여 첫 번째 줄(구매자명)이 라벨 경계선 및 갭에 걸쳐 잘리는 현상 해결',
    '- **한 장 건너뜀(빈 라벨 배출) 완전 차단**: 컨테이너 높이를 25.5mm로 안전 제한하여 브라우저 엔진의 2페이지 자동 생성 및 빈 용지 배출 방지',
    '- **세 줄 인쇄 양식**: 닉네임, 가격, 회차 3줄 정렬 및 테스트 버튼 문구 일원화',
    '- **판매 회차 연동**: 실제 판매 데이터의 회차(sessionId) 정보와 세 줄 테스트 출력 지원',
    '- **클라우드 댓글 수집 연동**: 플랫폼 댓글 ID, 사용자 ID, 닉네임과 원문을 상품 판매 피드로 안정적으로 전달',
    '- **판매·정정 전표 자동 출력**: 클라우드 인쇄 큐의 lease, spool, acknowledge 흐름과 중복 출력 방지 적용',
    '- **Vulkan GPU 오프라인 STT 포함**: DirectX 12/Vulkan 지원 환경의 whisper.cpp 가속 바이너리 패키징'
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
