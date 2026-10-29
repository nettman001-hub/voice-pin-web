import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/pages/seller/TouchMobileSalesPage.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  plugins: [{
    name: 'isolated-touch-page-backend',
    setup(builder) {
      builder.onResolve({
        filter: /\/(AuthContext|touchSalesApi|supabaseClient|productSalesApi|remoteWorkspaceService)$/,
      }, () => ({ path: 'backend-fixture', namespace: 'touch-ui-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'touch-ui-test' }, () => ({
        contents: `
          export const useAuth = () => ({ workspaceId: 'test-workspace', user: { nickname: '판매자' } });
          export class TouchSalesApi { constructor(workspaceId) { this.workspaceId = workspaceId; } }
          export const productSalesApi = {};
          export const remoteWorkspaceService = {};
          export const isSupabaseConfigured = true;
          export const requireSupabase = () => { throw new Error('SSR must not access backend'); };
        `,
      }));
    },
  }],
});

function firstRender(native) {
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require,
    console,
    crypto: { randomUUID },
    localStorage: { getItem: () => null },
    window: native ? {
      VoiceCapAndroid: { printerState: () => '{"connected":false,"name":""}' },
    } : {},
  });
  return renderToStaticMarkup(React.createElement(module.exports.default));
}

test('Android sales app shows phone setup immediately without PC connection warnings or mic controls', () => {
  const html = firstRender(true);
  assert.match(html, /폰 판매 대기/);
  assert.match(html, /폰으로 판매 시작/);
  assert.match(html, /폰으로 판매를 시작하면 실시간 댓글이 이곳에 표시됩니다\./);
  assert.doesNotMatch(html, /PC|마이크로 지연 측정|예비 연결|touch-status-offline/);
});

test('browser PC-linked sales keeps its connection status, delay controls and empty-comment guidance', () => {
  const html = firstRender(false);
  assert.match(html, /PC ● 끊김/);
  assert.match(html, /마이크로 지연 측정/);
  assert.match(html, /PC에서 판매 시작 후 실시간 댓글이 이곳에 표시됩니다\./);
  assert.doesNotMatch(html, /폰 판매 대기/);
});
