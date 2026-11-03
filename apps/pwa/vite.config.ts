import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'apps/pwa',
  base: process.env.FDU_PWA_BASE || '/',
  envDir: '.',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 5174 },
  build: { outDir: 'dist', emptyOutDir: true },
});
