import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sharedCjs } from './vite.shared.mjs';
import { pwa } from './mobile/pwa-plugin.mjs';
// The phone app: its own entry (mobile/), built into dist-mobile/ and served by the remote server of the desktop app.
export default defineConfig({
  root: 'mobile',
  base: './',
  publicDir: false,
  plugins: [sharedCjs(), react(), pwa()],
  build: { outDir: '../dist-mobile', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 700 },
  server: { port: 5174, strictPort: true, fs: { allow: ['..'] } },
});
