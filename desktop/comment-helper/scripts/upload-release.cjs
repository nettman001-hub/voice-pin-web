const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const OWNER = 'nettman001-hub';
const REPO = 'voice-pin-web';
const INSTALLER_NAME = 'VoiceCAP-Comment-Helper-Setup.exe';

function getGitHubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    const creds = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n', encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return creds.split('\n').find(line => line.startsWith('password='))?.slice(9).trim() || '';
  } catch (_) {
    return '';
  }
}

// electron-builder의 단일 Windows x64 채널 파일만 허용한다. YAML 확장/태그를 해석하지 않는다.
function parseLatestYaml(text) {
  const value = (expression, name) => {
    const matches = [...text.matchAll(expression)];
    if (matches.length !== 1) throw new Error(`latest.yml의 ${name} 항목이 올바르지 않습니다.`);
    return matches[0][1].trim().replace(/^(['"])(.*)\1$/, '$2');
  };
  if ([...text.matchAll(/^\s+- url:/gm)].length !== 1) {
    throw new Error('latest.yml에는 Windows x64 설치 파일 하나만 있어야 합니다.');
  }
  return {
    version: value(/^version:\s*(.+)$/gm, 'version'),
    path: value(/^path:\s*(.+)$/gm, 'path'),
    sha512: value(/^sha512:\s*(.+)$/gm, 'sha512'),
    fileUrl: value(/^  - url:\s*(.+)$/gm, 'files.url'),
    fileSha512: value(/^    sha512:\s*(.+)$/gm, 'files.sha512'),
    size: Number(value(/^    size:\s*(.+)$/gm, 'files.size'))
  };
}

function validateReleaseArtifacts(helperRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(helperRoot, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('안정 버전 번호가 올바르지 않습니다.');
  const releaseDir = path.join(helperRoot, 'release');
  const specs = [
    { name: INSTALLER_NAME, path: path.join(releaseDir, INSTALLER_NAME), type: 'application/octet-stream' },
    { name: `${INSTALLER_NAME}.blockmap`, path: path.join(releaseDir, `${INSTALLER_NAME}.blockmap`), type: 'application/octet-stream' },
    { name: 'latest.yml', path: path.join(releaseDir, 'latest.yml'), type: 'text/yaml' },
    { name: 'setup-offline-stt.bat', path: path.join(helperRoot, 'scripts', 'setup-offline-stt.bat'), type: 'application/x-bat' }
  ];
  const files = specs.map(spec => {
    if (!fs.existsSync(spec.path) || !fs.statSync(spec.path).isFile()) {
      throw new Error(`필수 배포 파일이 없습니다: ${spec.name}`);
    }
    // 검증한 내용 그대로 업로드하여 검증 이후 파일 변경의 영향을 받지 않는다.
    const data = fs.readFileSync(spec.path);
    if (!data.length) throw new Error(`배포 파일이 비어 있습니다: ${spec.name}`);
    return { ...spec, data };
  });
  const installer = files[0].data;
  if (installer[0] !== 0x4d || installer[1] !== 0x5a) throw new Error('Windows 설치 파일 형식이 아닙니다.');
  const metadata = parseLatestYaml(files[2].data.toString('utf8'));
  const sha512 = crypto.createHash('sha512').update(installer).digest('base64');
  if (metadata.version !== pkg.version) throw new Error('설치 파일 메타데이터와 package.json 버전이 다릅니다.');
  if (metadata.path !== INSTALLER_NAME || metadata.fileUrl !== INSTALLER_NAME) {
    throw new Error('latest.yml의 설치 파일 경로가 다릅니다.');
  }
  if (metadata.sha512 !== sha512 || metadata.fileSha512 !== sha512 || metadata.size !== installer.length) {
    throw new Error('설치 파일 크기 또는 SHA512가 latest.yml과 다릅니다. 다시 빌드해 주세요.');
  }
  return { version: pkg.version, files };
}

function getCommittedHead(helperRoot) {
  const repoRoot = path.resolve(helperRoot, '..', '..');
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--',
    'desktop/comment-helper', 'server', 'src/types/comment.ts'], { cwd: repoRoot, encoding: 'utf8' });
  if (dirty.trim()) throw new Error('댓글 도우미 소스 변경을 먼저 커밋해 주세요.');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('배포 대상 Git 커밋을 확인할 수 없습니다.');
  return head;
}

async function publishRelease({ version, files, head, token, fetchImpl = fetch, log = console.log }) {
  const tag = `comment-helper-v${version}`;
  const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const headers = {
    Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
    'User-Agent': 'VoiceCAP-Release-Uploader', 'X-GitHub-Api-Version': '2022-11-28'
  };
  async function request(url, options = {}) {
    return fetchImpl(url, { ...options, headers: { ...headers, ...options.headers } });
  }
  async function checkedJson(response, context) {
    if (!response.ok) throw new Error(`${context} 실패 (HTTP ${response.status})`);
    return response.json();
  }

  log(`[1/4] 릴리스 확인: ${tag} (${head})`);
  const existing = await request(`${apiBase}/releases/tags/${tag}`);
  let release;
  if (existing.ok) {
    release = await existing.json();
    if (!release.draft) throw new Error('공개된 동일 버전의 파일은 교체하지 않습니다. 버전을 올려 주세요.');
    if (release.target_commitish !== head) throw new Error('다른 커밋의 임시 릴리스입니다. 새 버전으로 배포해 주세요.');
  } else if (existing.status === 404) {
    release = await checkedJson(await request(`${apiBase}/releases`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag, target_commitish: head, name: `VoiceCAP 댓글 도우미 v${version}`,
        body: `### VoiceCAP 댓글 도우미 v${version}\n\n- 설치 후 실행 시 댓글 도우미가 즉시 종료되는 문제를 수정했습니다.\n- 기존 프린터 설정을 유지하며 설치할 수 있습니다.`,
        draft: true, prerelease: false, make_latest: 'false'
      })
    }), '임시 릴리스 생성');
  } else {
    throw new Error(`릴리스 조회 실패 (HTTP ${existing.status})`);
  }
  if (!release.draft) throw new Error('임시 릴리스 상태를 확인하지 못했습니다.');

  log('[2/4] 임시 릴리스에 파일 업로드');
  for (const file of files) {
    const previous = release.assets?.find(asset => asset.name === file.name);
    if (previous) {
      const removed = await request(`${apiBase}/releases/assets/${previous.id}`, { method: 'DELETE' });
      if (!removed.ok) throw new Error(`임시 파일 정리 실패: ${file.name} (HTTP ${removed.status})`);
    }
    const asset = await checkedJson(await request(
      `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`,
      { method: 'POST', headers: { 'Content-Type': file.type, 'Content-Length': String(file.data.length) }, body: file.data }
    ), `파일 업로드 ${file.name}`);
    if (asset.name !== file.name || asset.size !== file.data.length || asset.state !== 'uploaded') {
      throw new Error(`업로드 결과가 검증한 파일과 다릅니다: ${file.name}`);
    }
    log(`업로드 완료: ${file.name} (${file.data.length} bytes)`);
  }

  log('[3/4] 업로드 파일 전체 확인');
  const current = await checkedJson(await request(`${apiBase}/releases/${release.id}`), '임시 릴리스 확인');
  if (!current.draft || current.target_commitish !== head) throw new Error('임시 릴리스 상태가 변경되었습니다.');
  for (const file of files) {
    const asset = current.assets?.find(item => item.name === file.name);
    if (!asset || asset.size !== file.data.length || asset.state !== 'uploaded') {
      throw new Error(`공개 전 파일 확인 실패: ${file.name}`);
    }
  }
  log('[4/4] 검증한 릴리스 공개');
  const published = await checkedJson(await request(`${apiBase}/releases/${release.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    // GitHubProvider의 안정 채널은 /releases/latest를 읽으므로 댓글 도우미를 최신으로 지정한다.
    body: JSON.stringify({ draft: false, make_latest: 'true' })
  }), '릴리스 공개');
  if (published.draft) throw new Error('릴리스가 아직 임시 상태입니다.');
  log(`릴리스 URL: ${published.html_url}`);
  return published;
}

async function main() {
  const helperRoot = path.resolve(__dirname, '..');
  // 모든 로컬 검증을 마친 후에만 인증 정보와 GitHub에 접근한다.
  const artifacts = validateReleaseArtifacts(helperRoot);
  const head = getCommittedHead(helperRoot);
  const token = getGitHubToken();
  if (!token) throw new Error('GitHub 토큰을 찾을 수 없습니다.');
  await publishRelease({ ...artifacts, head, token });
}

module.exports = { parseLatestYaml, validateReleaseArtifacts, getCommittedHead, publishRelease };
if (require.main === module) {
  main().catch(error => {
    console.error(`업로드 중단: ${error.message}`);
    process.exitCode = 1;
  });
}
