import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// LAKEBRIDGE_API_URL is the orchestrator's address from the dev machine.
// In dev, Vite proxies `/api/*` there so the browser stays same-origin and
// no CORS handshake is needed. In production the UI is served from behind
// the same gateway as the API, so `/api/*` resolves directly.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const target = env.LAKEBRIDGE_API_URL ?? 'http://localhost:8080';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': { target, changeOrigin: true, ws: true },
      },
    },
  };
});
