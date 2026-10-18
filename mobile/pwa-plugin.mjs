// Emits the PWA files next to the bundle: manifest, service worker (with the list of built files) and icons.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const manifest = {
  name: 'VeSTA',
  short_name: 'VeSTA',
  description: 'Controle o VeSTA do seu computador pelo celular.',
  lang: 'pt-BR',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#111115',
  theme_color: '#111115',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
};
export function pwa() {
  return {
    name: 'vesta-pwa',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'icon', type: 'image/png', href: './icon-192.png' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: './icon-192.png' }, injectTo: 'head' },
    ],
    async generateBundle(_, bundle) {
      const icon = fs.readFileSync(path.join(root, 'assets/mascot/icon-512.png'));
      const small = await sharp(icon).resize(192, 192).png({ compressionLevel: 9 }).toBuffer();
      const big = await sharp(icon).resize(512, 512).png({ compressionLevel: 9 }).toBuffer();
      this.emitFile({ type: 'asset', fileName: 'icon-192.png', source: small });
      this.emitFile({ type: 'asset', fileName: 'icon-512.png', source: big });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest, null, 2) });
      const files = [
        './',
        './index.html',
        ...Object.keys(bundle).map((f) => './' + f),
        './icon-192.png',
        './manifest.webmanifest',
      ];
      const version = createHash('sha256')
        .update(
          files.join() +
            Object.values(bundle)
              .map((b) => b.code || b.source?.length)
              .join()
        )
        .digest('hex')
        .slice(0, 10);
      const sw = fs
        .readFileSync(path.join(import.meta.dirname, 'sw.template.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}
