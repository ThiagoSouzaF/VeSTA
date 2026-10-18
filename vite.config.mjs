import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sharedCjs } from './vite.shared.mjs';
export default defineConfig({ base: './', plugins: [sharedCjs(), react()], server: { port: 5173, strictPort: true } });
