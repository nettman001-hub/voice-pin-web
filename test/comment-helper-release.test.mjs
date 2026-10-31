import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateReleaseArtifacts, parseLatestYaml, publishRelease } = require('../desktop/comment-helper/scripts/upload-release.cjs');
const installerName = 'VoiceCAP-Comment-Helper-Setup.exe';
const version = '1.3.9';
const head = 'a'.repeat(40);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voicecap-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'release'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  const data = Buffer.from('MZinstaller-test-data');
  const sha = crypto.createHash('sha512').update(data).digest('base64');
  const yaml = `version: ${version}\nfiles:\n  - url: ${installerName}\n    sha512: ${sha}\n    size: ${data.length}\npath: ${installerName}\nsha512: ${sha}\nreleaseDate: '2026-10-31T00:00:00.000Z'\n`;
  fs.writeFileSync(path.join(root, 'release', installerName), data);
  fs.writeFileSync(path.join(root, 'release', `${installerName}.blockmap`), 'blockmap');
  fs.writeFileSync(path.join(root, 'release', 'latest.yml'), yaml);
  fs.writeFileSync(path.join(root, 'scripts', 'setup-offline-stt.bat'), '@echo off');
  return { root, yaml };
}

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(payload) };
}

function fakeGitHub({ initialStatus = 404, initialRelease, failUpload = false, omitAtCheck = false } = {}) {
  const calls = [];
  const release = { id: 42, draft: true, target_commitish: head, assets: [], ...initialRelease };
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (url.includes('/releases/tags/')) return response(initialStatus, release);
    if (url.endsWith('/releases') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.draft, true);
      assert.equal(body.target_commitish, head);
      assert.equal(body.make_latest, 'false');
      return response(201, release);
    }
    if (url.includes('/releases/assets/') && options.method === 'DELETE') return response(204);
    if (url.startsWith('https://uploads.github.com/')) {
      if (failUpload) return response(500);
      const name = new URL(url).searchParams.get('name');
      const asset = { id: release.assets.length + 1, name, size: options.body.length, state: 'uploaded' };
      release.assets = [...release.assets.filter(item => item.name !== name), asset];
      return response(201, asset);
    }
    if (url.endsWith('/releases/42') && options.method === 'PATCH') {
      assert.equal(JSON.parse(options.body).make_latest, 'true');
      assert.equal(release.assets.length, 4);
      return response(200, { ...release, draft: false, html_url: 'https://example.test/release' });
    }
    if (url.endsWith('/releases/42')) {
      return response(200, { ...release, assets: omitAtCheck ? release.assets.slice(1) : release.assets });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return { calls, fetchImpl };
}

test('helper release verifies a complete installer, metadata, and blockmap without network access', t => {
  const { root } = fixture(t);
  const artifacts = validateReleaseArtifacts(root);
  assert.equal(artifacts.version, version);
  assert.equal(artifacts.files.length, 4);
  assert.equal(artifacts.files[0].data.toString(), 'MZinstaller-test-data');
});

test('helper release rejects every missing required asset before upload', t => {
  for (const asset of [installerName, `${installerName}.blockmap`, 'latest.yml']) {
    const { root } = fixture(t);
    fs.unlinkSync(path.join(root, 'release', asset));
    assert.throws(() => validateReleaseArtifacts(root), /필수 배포 파일/);
  }
});

test('helper release rejects empty or non-executable installer files', t => {
  for (const data of ['', '<html>not an exe</html>']) {
    const { root } = fixture(t);
    fs.writeFileSync(path.join(root, 'release', installerName), data);
    assert.throws(() => validateReleaseArtifacts(root), /비어|설치 파일 형식/);
  }
});

test('helper release detects stale version, size, paths, and installer content', t => {
  for (const mutate of [
    yaml => yaml.replace('version: 1.3.9', 'version: 1.3.8'),
    yaml => yaml.replace('size: 21', 'size: 22'),
    yaml => yaml.replace('path: VoiceCAP', 'path: Other'),
    yaml => yaml.replace(/sha512: /g, 'sha512: INVALID')
  ]) {
    const { root, yaml } = fixture(t);
    fs.writeFileSync(path.join(root, 'release', 'latest.yml'), mutate(yaml));
    assert.throws(() => validateReleaseArtifacts(root), /버전|경로|SHA512/);
  }
});

test('helper release rejects ambiguous update metadata', t => {
  const { yaml } = fixture(t);
  assert.throws(() => parseLatestYaml(`${yaml}version: 1.3.8\n`), /version/);
  assert.throws(() => parseLatestYaml(`${yaml}  - url: wrong.exe\n`), /하나만/);
});

test('helper release uploads to a draft at committed HEAD and publishes after all assets are verified', async t => {
  const { root } = fixture(t);
  const mock = fakeGitHub();
  const result = await publishRelease({ ...validateReleaseArtifacts(root), head, token: 'fake', ...mock, log() {} });
  assert.equal(result.draft, false);
  assert.equal(mock.calls.filter(call => call.url.startsWith('https://uploads.github.com/')).length, 4);
  assert.equal(mock.calls.at(-1).method, 'PATCH');
});

test('helper release never replaces assets in an already published version', async t => {
  const { root } = fixture(t);
  const mock = fakeGitHub({ initialStatus: 200, initialRelease: { draft: false } });
  await assert.rejects(publishRelease({ ...validateReleaseArtifacts(root), head, token: 'fake', ...mock, log() {} }), /교체하지/);
  assert.equal(mock.calls.length, 1);
});

test('helper release lookup failure does not create or publish a release', async t => {
  const { root } = fixture(t);
  const mock = fakeGitHub({ initialStatus: 403 });
  await assert.rejects(publishRelease({ ...validateReleaseArtifacts(root), head, token: 'fake', ...mock, log() {} }), /조회 실패/);
  assert.equal(mock.calls.length, 1);
});

test('helper release upload failure or missing confirmed asset leaves draft unpublished', async t => {
  for (const options of [{ failUpload: true }, { omitAtCheck: true }]) {
    const { root } = fixture(t);
    const mock = fakeGitHub(options);
    await assert.rejects(publishRelease({ ...validateReleaseArtifacts(root), head, token: 'fake', ...mock, log() {} }), /업로드|공개 전 파일/);
    assert.equal(mock.calls.some(call => call.method === 'PATCH'), false);
  }
});

test('helper release resumes only drafts from the same commit', async t => {
  const { root } = fixture(t);
  const wrong = fakeGitHub({ initialStatus: 200, initialRelease: { target_commitish: 'b'.repeat(40) } });
  await assert.rejects(publishRelease({ ...validateReleaseArtifacts(root), head, token: 'fake', ...wrong, log() {} }), /다른 커밋/);
  assert.equal(wrong.calls.length, 1);
  const retry = fakeGitHub({ initialStatus: 200, initialRelease: { assets: [{ id: 100, name: installerName }] } });
  await publishRelease({ ...validateReleaseArtifacts(root), head, token: 'fake', ...retry, log() {} });
  assert.equal(retry.calls[1].method, 'DELETE');
  assert.equal(retry.calls.at(-1).method, 'PATCH');
});
