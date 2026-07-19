import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.ONECREW_PREVIEW_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/v1': apiTarget,
      '/healthz': apiTarget,
      '/readyz': apiTarget,
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { sourcemap: true },
});
