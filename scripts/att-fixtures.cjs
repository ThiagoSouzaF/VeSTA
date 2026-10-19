// Test files for the attachment checks: a PNG with a known word, and a one-page PDF / a TXT with a code phrase.
const fs = require('node:fs'),
  path = require('node:path');

// Black square with the word in big white letters (sharp renders the SVG).
async function makePng(file, word = 'VESTA42', size = 640) {
  const sharp = require('sharp');
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    size +
    '" height="' +
    size +
    '"><rect width="100%" height="100%" fill="#000"/><rect x="24" y="24" width="' +
    (size - 48) +
    '" height="' +
    (size - 48) +
    '" fill="none" stroke="#fff" stroke-width="6"/><text x="50%" y="54%" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="' +
    Math.round(size / 4.6) +
    '" fill="#fff">' +
    word +
    '</text></svg>';
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}
// Valid single-page PDF (Helvetica text, correct xref table).
function makePdf(file, phrase = 'CODIGO-AZUL-77') {
  const stream = 'BT /F1 28 Tf 60 700 Td (Frase secreta: ' + phrase + ') Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += i + 1 + ' 0 obj\n' + o + '\nendobj\n';
  });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  fs.writeFileSync(file, out, 'latin1');
  return file;
}
function makeTxt(file, phrase = 'LUA-VERDE-58') {
  fs.writeFileSync(file, 'Documento de teste do VeSTA.\nA frase-código é: ' + phrase + '\nFim.\n');
  return file;
}
module.exports = { makePng, makePdf, makeTxt };
