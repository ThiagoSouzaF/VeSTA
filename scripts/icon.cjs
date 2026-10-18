const fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const sharp = require('sharp'),
    ico = (await import('png-to-ico')).default;
  const assets = path.resolve(__dirname, '../assets');
  const svg = path.join(assets, 'vesta.svg'),
    png = path.join(assets, 'vesta.png');
  await sharp(svg).resize(512, 512).png().toFile(png);
  const images = await Promise.all(
    [16, 24, 32, 48, 64, 128, 256].map((size) => sharp(svg).resize(size, size).png().toBuffer())
  );
  fs.writeFileSync(path.join(assets, 'vesta.ico'), await ico(images));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
