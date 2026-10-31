import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['test/fixtures/phoneLifecycleApp.tsx'],
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'phone-lifecycle-fixture', setup(builder) {
    builder.onResolve({ filter: /\/(AuthContext|touchSalesApi|supabaseClient|productSalesApi|remoteWorkspaceService)$/ },
      () => ({ path: path.join(root, 'test/fixtures/phoneLifecycleMock.ts') }));
    builder.onResolve({ filter: /\/frontCamera$/ }, () => ({ path: 'camera', namespace: 'phone-lifecycle-mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'phone-lifecycle-mock' }, () => ({ contents: `
      export const startFrontCamera = async () => {
        const state = window.phoneLifecycle.state;
        state.cameraStarts++;
        if (state.cameraError) throw new Error(state.cameraError);
        return { getTracks: () => [{ stop() {} }] };
      };
      export const grabSharpestFrame = async () => {
        const state = window.phoneLifecycle.state;
        state.captureFrames++;
        if (state.captureFrameDelayMs) await new Promise(resolve => setTimeout(resolve, state.captureFrameDelayMs));
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 2;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
        return { blob, url: URL.createObjectURL(blob) };
      };
    ` }));
  } }],
});
const server = http.createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(result.outputFiles[0].text); return; }
  if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(path.join(root, 'src/styles/touchSales.css'))); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}button{font-family:inherit}</style><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
server.listen(Number(process.env.PORT || 43188), '127.0.0.1', () => console.log(`Phone lifecycle fixture: http://127.0.0.1:${server.address().port}/`));
