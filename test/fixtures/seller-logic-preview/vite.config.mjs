import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const path = (name) => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  root: path('./'), plugins: [react()],
  resolve: { alias: [
    { find: /^(?:\.\.\/)+context\/(?:LiveContext|CommentCaptureContext)$/, replacement: path('./stubs.ts') },
    { find: /^\.\.\/\.\.\/services\/(?:sellerLogicApi|sellerLogicCapture)$/, replacement: path('./stubs.ts') },
  ] },
  server: { host: '127.0.0.1', port: 5188, strictPort: true, fs: { allow: [path('../../../')] } },
});
