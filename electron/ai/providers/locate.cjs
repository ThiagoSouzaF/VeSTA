// Finds a provider's executable (PATH, then the places each CLI installs itself).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const drael = require('../drael.cjs');

// Where the Node.js installer puts node.exe (and `npm i -g` the OpenCode package) when NODE_EXE is not set.
const DEFAULT_NODE_DIR = 'C:\\Program Files\\nodejs';

function locate(name) {
  if (name === 'drael') return drael.locate();
  const home = os.homedir(),
    local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const names = [name + '.exe'];
  const candidates = (process.env.PATH || '')
    .split(path.delimiter)
    .flatMap((dir) => names.map((n) => path.join(dir, n)));
  candidates.push(path.join(home, '.local', 'bin', name + '.exe'));
  if (name === 'opencode') {
    // `npm i -g opencode-ai` leaves only an opencode.cmd shim on PATH; the real executable sits in the package, next
    // to the shim. With nvm, the package belongs to the Node version it was installed with, which may not be the
    // active one: every installed version is tried, newest first.
    let nvm = [];
    const nvmHome =
      process.env.NVM_HOME || path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'nvm');
    try {
      nvm = fs
        .readdirSync(nvmHome)
        .filter((d) => /^v\d/.test(d))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((d) => path.join(nvmHome, d));
    } catch {}
    for (const dir of [
      process.env.NODE_EXE ? path.dirname(process.env.NODE_EXE) : DEFAULT_NODE_DIR,
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
      ...(process.env.PATH || '').split(path.delimiter),
      ...nvm,
    ].filter(Boolean))
      candidates.push(path.join(dir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  }
  if (name === 'codex') {
    const base = path.join(local, 'OpenAI', 'Codex', 'bin');
    try {
      for (const d of fs.readdirSync(base).reverse()) candidates.push(path.join(base, d, 'codex.exe'));
    } catch {}
  }
  return candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}
module.exports = { locate, DEFAULT_NODE_DIR };
