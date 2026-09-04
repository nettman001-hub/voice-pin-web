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

  const owner = 'nettman001-hub';
  const repo = 'voice-pin-web';
  const tag = 'comment-helper-v1.2.0';
  const releaseName = 'VoiceCAP 댓글 도우미 v1.2.0';
  const releaseBody = [
    '### VoiceCAP 댓글 도우미 v1.2.0',
    '',
    '- **무료 오프라인 로컬 STT (faster-whisper) 연동**: 클라우드 API 사용료 없이 사용자 PC에서 실시간 음성인식 처리',
    '- **도우미 창 UI 보강**: 로컬 STT 준비 상태(`base`, `CPU int8` 가속) 실시간 표시',
    '- **TikTok 라이브 댓글 및 라벨 프린터(50x30mm) 자동 연동**'
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
  const filesToUpload = [
    'VoiceCAP-Comment-Helper-Setup.exe',
    'latest.yml',
    'VoiceCAP-Comment-Helper-Setup.exe.blockmap'
  ].filter(f => fs.existsSync(path.join(releaseDir, f)));

  console.log(`[2/4] 업로드 대상 파일: ${filesToUpload.join(', ')}`);

  // 기존 릴리스에 이미 올라간 동일 파일이 있다면 먼저 삭제
  const existingAssets = release.assets || [];
  for (const filename of filesToUpload) {
    const matched = existingAssets.find(a => a.name === filename);
    if (matched) {
      console.log(`기존 에셋 삭제: ${filename} (ID: ${matched.id})`);
      await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${matched.id}`, {
        method: 'DELETE',
        headers
      });
    }
  }

  // 파일 업로드 진행
  console.log('[3/4] 파일 업로드 시작...');
  for (const filename of filesToUpload) {
    const filePath = path.join(releaseDir, filename);
    const stat = fs.statSync(filePath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    console.log(`업로드 중: ${filename} (${sizeMb} MB)...`);

    const fileStream = fs.readFileSync(filePath);
    const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(filename)}`;

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': filename.endsWith('.exe') ? 'application/octet-stream' : 'text/yaml',
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
