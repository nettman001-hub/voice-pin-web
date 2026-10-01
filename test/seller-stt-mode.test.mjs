import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = fs.readFileSync(new URL('../src/components/seller/SellerSettingsModal.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require(name) {
  if (name === 'react') return React;
  if (name === 'react-router-dom') return { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) };
  if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
  throw new Error(name);
} });
const base = { isOpen: true, onClose() {}, isDemoActive: false, demoElapsedSeconds: 0,
  onToggleDemo() {}, audioSourceMode: 'TAB_AUDIO', sttProvider: 'SONIOX',
  onChangeSttMode() {}, canUseCloudStt: true };
const render = (props) => renderToStaticMarkup(React.createElement(exports.SellerSettingsModal, { ...base, ...props }));
const modeButton = (html, mode) => html.match(new RegExp(`<button[^>]*>${mode}</button>`))[0];

test('seller settings describe the actual local engine, not the configured cloud provider', () => {
  const html = render({ sttMode: 'LOCAL', localSttModel: 'base' });
  assert.match(html, /내 PC Whisper \(base\)/);
  assert.doesNotMatch(html, /Soniox v5/);
  assert.match(html, /클라우드 STT를 호출하지 않습니다/);
  assert.match(modeButton(html, '내 PC STT'), /aria-pressed="true"/);
  assert.doesNotMatch(modeButton(html, '클라우드 STT'), / disabled=""/);
});

test('cloud selection is available at rest, disabled while listening and guarded by cloud access', () => {
  const html = render({ sttMode: 'CLOUD' });
  assert.match(html, /Soniox v5/);
  assert.match(modeButton(html, '클라우드 STT'), /aria-pressed="true"/);
  for (const mode of ['내 PC STT', '클라우드 STT']) {
    assert.match(modeButton(render({ sttMode: 'CLOUD', isListening: true }), mode), / disabled=""/);
  }
  assert.match(modeButton(render({ sttMode: 'LOCAL', canUseCloudStt: false }), '클라우드 STT'), / disabled=""/);
});
