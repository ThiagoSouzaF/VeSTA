import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// electron/tasks.cjs is pure and shared with the renderer: expose its module.exports as the default ES export.
const sharedCjs = () => ({
  name: 'vesta-shared-cjs',
  enforce: 'pre',
  transform(code, id) {
    if (!/electron[\/]tasks\.cjs$/.test(id.split('?')[0])) return null;
    return {
      code:
        'const module = { exports: {} };\nconst exports = module.exports;\n' +
        code +
        '\nexport default module.exports;\n',
      map: null,
    };
  },
});
export default defineConfig({ base: './', plugins: [sharedCjs(), react()], server: { port: 5173, strictPort: true } });
