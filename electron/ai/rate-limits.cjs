// One-shot read of the Codex plan windows: starts an ephemeral `codex app-server`, asks account/rateLimits/read
// and always ends the process. Used when the Usage tab opens, without needing a chat turn.
const { spawn } = require('node:child_process');
const { childEnv, CODEX_PRIVATE_ARGS } = require('../app/privacy.cjs');
const { lines, json } = require('./drivers/ndjson.cjs');
const { kill } = require('../util/proc.cjs');
const { codexRateLimits } = require('./usage.cjs');
const { tail, lastLine } = require('../util/text.cjs');
// -> {windows, planType, credits}; rejects on timeout, missing login or a process that dies early.
function readCodexRateLimits(
  exe,
  { timeoutMs = 8000, args = ['app-server', ...CODEX_PRIVATE_ARGS], env = childEnv() } = {}
) {
  return new Promise((resolve, reject) => {
    if (!exe) return reject(new Error('Codex não encontrado'));
    const child = spawn(exe, args, {
      env: { ...env, ELECTRON_RUN_AS_NODE: undefined },
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false,
      stderr = '';
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {}
      kill(child);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('O Codex demorou para responder')), timeoutMs);
    const send = (o) => child.stdin.writable && child.stdin.write(JSON.stringify(o) + '\n');
    child.stdin.on('error', () => {});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (b) => (stderr = tail(stderr, b, 2000)));
    child.on('error', (e) => finish(reject, e));
    child.on('close', () => finish(reject, new Error(lastLine(stderr) || 'O Codex encerrou ao iniciar')));
    lines(child.stdout, (l) => {
      const m = json(l);
      if (!m || m.id == null || m.method) return;
      if (m.id === 1) {
        send({ jsonrpc: '2.0', method: 'initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read' });
      } else if (m.id === 2) {
        if (m.error) return finish(reject, new Error(m.error.message || 'Não foi possível ler os limites do Codex'));
        const r = codexRateLimits(m.result);
        finish(resolve, r);
      }
    });
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'vesta', title: 'VeSTA', version: '0' }, capabilities: null },
    });
  });
}
module.exports = { readCodexRateLimits };
