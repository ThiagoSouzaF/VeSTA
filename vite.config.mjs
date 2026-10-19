import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sharedCjs } from './vite.shared.mjs';
// Two entries: the app (index.html) and the static opening window (splash.html, no React).
export default defineConfig({
  base: './',
  plugins: [sharedCjs(), react()],
  server: { port: 5173, strictPort: true },
  build: { rollupOptions: { input: { main: 'index.html', splash: 'splash.html' } } },
});
