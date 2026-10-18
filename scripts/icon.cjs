// Builds the app icons from the mascot artwork: assets/vesta.png (512px) and assets/vesta.ico.
// Large sizes use the full icon; at 32px and below only the blindfolded face stays legible, so those use a crop.
const fs = require('node:fs'),
  path = require('node:path');
const assets = path.resolve(__dirname, '../assets');
const source = path.join(assets, 'mascot', 'icon-512.png');
const FACE = { left: 150, top: 95, width: 215, height: 215 };
const PAPER = '#f4f1ea';

async function tile(sharp, art, size) {
  const inner = Math.round(size * (art === 'face' ? 0.9 : 0.86));
  const base = sharp(source);
  const picture = await (art === 'face' ? base.extract(FACE) : base).resize(inner, inner).png().toBuffer();
  const radius = Math.round(size * 0.22);
  const card = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${PAPER}"/></svg>`
  );
  return sharp(card)
    .composite([{ input: picture, gravity: 'center' }])
    .png()
    .toBuffer();
}

(async () => {
  const sharp = require('sharp'),
    ico = (await import('png-to-ico')).default;
  fs.writeFileSync(path.join(assets, 'vesta.png'), await tile(sharp, 'full', 512));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map((size) => tile(sharp, size <= 32 ? 'face' : 'full', size)));
  fs.writeFileSync(path.join(assets, 'vesta.ico'), await ico(images));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
