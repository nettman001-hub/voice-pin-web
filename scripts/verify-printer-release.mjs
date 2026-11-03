import assert from 'node:assert/strict';

// Check the deployed app, not just the local build: native XP support requires
// matching web encoders and controls. No login, sales or printer writes occur.
const base = new URL(process.argv.slice(2).find(arg => arg.startsWith('https://')) || 'https://www.voicecap.shop/');
async function read(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert.ok(response.ok, `${url}: HTTP ${response.status}`);
  return response.text();
}
const html = await read(base);
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/g)]
  .map(m => new URL(m[1], base))
  .filter(url => url.origin === base.origin && url.pathname.startsWith('/assets/'));
assert.ok(scripts.length, 'entry script missing');
const assets = new Map();
for (const url of scripts) {
  const source = await read(url);
  assets.set(url.href, source);
  for (const match of source.matchAll(/["']([^"']*TouchMobileSalesPage-[\w-]+\.js)["']/g)) {
    const relative = match[1];
    const chunk = relative.startsWith('assets/') ? new URL(relative, base) : new URL(relative, url);
    assert.equal(chunk.origin, base.origin);
    if (!assets.has(chunk.href)) assets.set(chunk.href, await read(chunk));
  }
}
// Shared encoders/streams may be split out of the page chunk by Vite.
for (const [href, source] of assets) {
  for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+\.js)["']/g)) {
    const dependency = new URL(match[1], href);
    if (dependency.origin !== base.origin || !dependency.pathname.startsWith('/assets/') || assets.has(dependency.href)) continue;
    assert.ok(assets.size < 30, 'unexpectedly large static dependency graph');
    assets.set(dependency.href, await read(dependency));
  }
}
const combined = [...assets.values()].join('\n');
for (const marker of ['XP_237BT', 'printerPickV2', '시험 출력', '40x25', '40x30', 'GAPDETECT'])
  assert.ok(combined.includes(marker), `deployed web missing printer support: ${marker}`);
if (process.argv.includes('--compact'))
  for (const marker of ['판매 설정 숨기기', '키핑하기', '오늘합계', '전표O', 'setWebNavigation'])
    assert.ok(combined.includes(marker), `deployed web missing compact sale support: ${marker}`);
if (process.argv.includes('--comments'))
  for (const marker of ['NO_FRAMES', 'ROOM_STALLED', 'TOKEN_TIMEOUT', 'CONNECT_TIMEOUT', '댓글 재연결'])
    assert.ok(combined.includes(marker), `deployed web missing comment recovery support: ${marker}`);
console.log(JSON.stringify({ ok: true, url: base.href, assets: [...assets.keys()],
  checks: ['XP model and native bridge', 'test print control', 'three paper sizes', 'TSPL encoder',
    ...(process.argv.includes('--compact') ? ['compact sale controls, keeping, buyer totals and shared navigation'] : []),
    ...(process.argv.includes('--comments') ? ['comment watchdog, connection timeouts and reconnect control'] : [])] }, null, 2));
