// Pré-carregado por `npm test` (node --test --require). Registra cada pasta criada com fs.mkdtempSync dentro de
// os.tmpdir() e a apaga quando o processo de teste termina, para os testes não deixarem pastas em %TEMP%.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');

const criadas = [];
const original = fs.mkdtempSync;
fs.mkdtempSync = function (prefixo, ...resto) {
  const dir = original.call(this, prefixo, ...resto);
  if (typeof dir === 'string' && path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) criadas.push(dir);
  return dir;
};
process.on('exit', () => {
  for (const dir of criadas)
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {}
});
