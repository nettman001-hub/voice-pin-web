import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { _electron as electron } from 'playwright';

// Run against the packaged binary, never the development electron executable.
// An isolated profile preserves the seller's printer, login and comment settings.
const executablePath = path.resolve(process.argv[2] || 'desktop/comment-helper/release/win-unpacked/VoiceCAP 댓글 도우미.exe');
const output = path.resolve('.tools/helper-startup');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'smoke-profile-'));
fs.writeFileSync(path.join(profile, 'auto-start-initialized'), '1');
const expectedVersion = JSON.parse(fs.readFileSync('desktop/comment-helper/package.json', 'utf8')).version;
let app;
try {
  app = await electron.launch({ executablePath, args: ['--hidden', `--user-data-dir=${profile}`], timeout: 60000 });
  const page = await app.firstWindow();
  let status;
  const deadline = Date.now() + 45000;
  do {
    status = await page.evaluate(() => window.voicecap.getStatus());
    if (status.helper === 'running') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  assert.equal(status.helper, 'running', status.message);
  assert.equal(status.version, expectedVersion);
  const health = await app.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:2137/status');
    return response.json();
  });
  assert.ok(health.tiktok);
  const firstPid = app.process().pid;
  const second = spawn(executablePath, ['--hidden', `--user-data-dir=${profile}`], { windowsHide: true, stdio: 'ignore' });
  const secondExit = await Promise.race([
    new Promise(resolve => second.once('exit', code => resolve(code))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Second instance did not exit')), 10000).unref())
  ]);
  assert.equal(secondExit, 0);
  assert.equal(app.process().pid, firstPid);
  await page.evaluate(() => window.voicecap.hideWindow());
  await page.screenshot({ path: path.join(output, 'helper-startup.png') });
  assert.equal((await page.evaluate(() => window.voicecap.getStatus())).helper, 'running');
  const exited = new Promise(resolve => app.process().exitCode !== null ? resolve() : app.process().once('exit', resolve));
  await page.evaluate(() => { setTimeout(() => window.voicecap.quit(), 50); });
  await exited;
  app = undefined;
  await assert.rejects(fetch('http://127.0.0.1:2137/status', { signal: AbortSignal.timeout(2000) }));
  const report = { version: expectedVersion, executablePath, startup: 'PASS', health: 'PASS', singleInstance: 'PASS', ownedServerShutdown: 'PASS' };
  fs.writeFileSync(path.join(output, 'packaged-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (app) await app.close().catch(() => {});
}
