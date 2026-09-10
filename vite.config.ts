import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-api-ai-models-proxy',
      configureServer(server) {
        server.middlewares.use('/api/ai-models', async (req, res) => {
          try {
            const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const endpointUrl = urlObj.searchParams.get('endpointUrl');
            if (!endpointUrl) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, models: [], message: 'endpointUrl 필요' }));
              return;
            }
            const clean = endpointUrl.trim().replace(/\/+$/, '');
            let modelsUrl = clean.endsWith('/v1/models') || clean.endsWith('/models')
              ? clean
              : (clean.endsWith('/chat/completions')
                ? clean.replace(/\/chat\/completions$/, '/models')
                : (clean.endsWith('/v1') ? `${clean}/models` : `${clean}/v1/models`));

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const r = await fetch(modelsUrl, { headers: { Accept: 'application/json' }, signal: controller.signal }).catch(() => null);
            clearTimeout(timeout);

            let models: string[] = [];
            if (r && r.ok) {
              const data: any = await r.json().catch(() => null);
              const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []));
              models = list.map((m: any) => (typeof m === 'string' ? m : (m?.id || m?.name || m?.model || ''))).filter(Boolean);
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: models.length > 0, models, source: 'DEV_PROXY' }));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, models: [], message: e?.message }));
          }
        });

        server.middlewares.use('/api/ai-health', async (req, res) => {
          try {
            let body = {};
            if (req.method === 'POST') {
              const buffers: any[] = [];
              for await (const chunk of req) buffers.push(chunk);
              const data = Buffer.concat(buffers).toString();
              try { body = JSON.parse(data); } catch {}
            }
            const { default: handler } = await import('./api/ai-health.ts');
            const mockRes = {
              statusCode: 200,
              headers: {} as Record<string, string>,
              setHeader(k: string, v: string) { this.headers[k] = v; return this; },
              status(code: number) { this.statusCode = code; return this; },
              json(data: any) {
                res.statusCode = this.statusCode;
                res.setHeader('Content-Type', 'application/json');
                Object.entries(this.headers).forEach(([k, v]) => res.setHeader(k, v));
                res.end(JSON.stringify(data));
              },
              end() { res.end(); }
            };
            await handler({ ...req, body }, mockRes);
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, message: e?.message }));
          }
        });

        server.middlewares.use('/api/ai-settings', async (req, res) => {
          try {
            let body = {};
            if (req.method === 'POST') {
              const buffers: any[] = [];
              for await (const chunk of req) buffers.push(chunk);
              const data = Buffer.concat(buffers).toString();
              try { body = JSON.parse(data); } catch {}
            }
            const { default: handler } = await import('./api/ai-settings.ts');
            const mockRes = {
              statusCode: 200,
              headers: {} as Record<string, string>,
              setHeader(k: string, v: string) { this.headers[k] = v; return this; },
              status(code: number) { this.statusCode = code; return this; },
              json(data: any) {
                res.statusCode = this.statusCode;
                res.setHeader('Content-Type', 'application/json');
                Object.entries(this.headers).forEach(([k, v]) => res.setHeader(k, v));
                res.end(JSON.stringify(data));
              },
              end() { res.end(); }
            };
            await handler({ ...req, body }, mockRes);
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, message: e?.message }));
          }
        });
      },
    },
  ],
  server: {
    port: 3000,
    open: false,
  },
});
