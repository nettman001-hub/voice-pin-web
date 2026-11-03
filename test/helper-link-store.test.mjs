import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/services/helperLinkStore.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
/** 앱 한 번 실행 = 모듈을 새로 읽는다(메모리는 비고 기기 저장소만 남음). */
function launch(localStorage, native = null) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, localStorage, crypto,
    require: () => ({ androidNative: () => native, androidJson: (raw, fb) => { try { return raw ? JSON.parse(raw) : fb; } catch { return fb; } } }),
  });
  return module.exports;
}

test('old app / browser: the PC helper link survives an app restart and is cleared on unlink', () => {
  const ls = storage();
  assert.equal(launch(ls).saveHelperLink('ws1', 'vcpl_tok'), true);
  const again = launch(ls);
  assert.equal(again.readHelperLink('ws1'), 'vcpl_tok');
  assert.equal(again.readHelperLink('ws2'), null);
  again.clearHelperLink('ws1');
  assert.equal(launch(ls).readHelperLink('ws1'), null);
});

test('new app (Keystore vault): an old plain link moves into the vault on first read', () => {
  const ls = storage();
  ls.setItem('voicecap-helper-link:ws1', 'vcpl_old');
  const vault = new Map();
  const native = { helperLinkGet: (w) => vault.get(w) || '', helperLinkSet: (w, t) => (vault.set(w, t), true), helperLinkClear: (w) => vault.delete(w) };
  const s = launch(ls, native);
  assert.equal(s.readHelperLink('ws1'), 'vcpl_old');
  assert.equal(vault.get('ws1'), 'vcpl_old');
  assert.equal(ls.getItem('voicecap-helper-link:ws1'), null, 'plain copy removed after moving');
  assert.equal(launch(ls, native).readHelperLink('ws1'), 'vcpl_old');
  assert.equal(s.saveHelperLink('ws1', 'vcpl_new'), true);
  assert.equal(ls.getItem('voicecap-helper-link:ws1'), null, 'vault apps never write the plain copy');
});
