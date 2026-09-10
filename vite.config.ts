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
      },
    },
  ],
  server: {
    port: 3000,
    open: false,
  },
});
