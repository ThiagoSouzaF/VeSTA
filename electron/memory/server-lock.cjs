// The AI Memory server's identity file (port + token) and the data-dir lock: finding, adopting or ending a previous
// run's server, and explaining why a start failed.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sleep, writeAtomic } = require('../util/sys.cjs');
const { lastLine } = require('../util/text.cjs');
// ---- Server identity (port + token), kept so the hook spool never points at a dead address -------------------------
const identityFile = (dir) => path.join(dir, 'vesta-server.json');
function readIdentity(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(identityFile(dir), 'utf8'));
    if (Number.isInteger(j.port) && typeof j.token === 'string' && j.token.length >= 16)
      return { port: j.port, token: j.token, url: 'http://127.0.0.1:' + j.port };
  } catch {}
  return {};
}
function writeIdentity(dir, { port, token }) {
  try {
    writeAtomic(identityFile(dir), JSON.stringify({ port, token }));
  } catch {}
}
// ---- Orphans and the data-dir lock ---------------------------------------------------------------------------------
const pidOf = (text, re) => {
  const n = Number((re.exec(String(text)) || [])[1]);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
// Executable name of a process ('' when unknown). Only ai-memory processes are ever touched.
function imageOf(pid) {
  if (process.platform !== 'win32') return 'ai-memory';
  try {
    const out = execFileSync('tasklist.exe', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    return /^"([^"]+)"/.exec(out.trim())?.[1] || '';
  } catch {
    return '';
  }
}
async function killPid(pid) {
  try {
    process.kill(pid);
  } catch {}
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(50);
}
// Does a server answer on this identity (and accept its token)?
async function healthy({ url, token }) {
  if (!url || !token) return false;
  try {
    const r = await fetch(url + '/admin/profile/status', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}
// An HTTP server outlives a crashed app and keeps the data-dir lock. Before starting, look at who holds it:
//  - `vesta-server.pid` (ours) and `.serve.lock.holder` (`pid=N`, written by the server itself);
//  - a pid that is gone, or now belongs to another program (pid reuse), is stale: its holder file is removed;
//  - a live ai-memory that answers with our identity is adopted (reused);
//  - a live ai-memory that does not answer is ended (the dir is ours, so it can only be our own leftover).
// Returns { adopted: {pid}|null, killed: [pid], stale: [pid], removed: [file] }.
async function reclaim(dir, { identity = {}, isAlive = alive, image = imageOf, end = killPid, probe = healthy } = {}) {
  const out = { adopted: null, killed: [], stale: [], removed: [] };
  const files = [
    { file: path.join(dir, 'vesta-server.pid'), re: /(\d+)/ },
    { file: path.join(dir, '.serve.lock.holder'), re: /pid=(\d+)/ },
  ];
  const seen = new Map();
  for (const { file, re } of files) {
    let pid = 0;
    try {
      pid = pidOf(fs.readFileSync(file, 'utf8'), re);
    } catch {}
    if (pid && pid !== process.pid) seen.set(pid, [...(seen.get(pid) || []), file]);
    else if (!pid && fs.existsSync(file)) seen.set(0, [...(seen.get(0) || []), file]);
  }
  const forget = (list) => {
    for (const f of list) {
      if (path.basename(f) === 'vesta-server.pid' || path.basename(f) === '.serve.lock.holder')
        try {
          fs.rmSync(f, { force: true });
          out.removed.push(f);
        } catch {}
    }
  };
  for (const [pid, list] of seen) {
    if (!pid) {
      forget(list);
      continue;
    }
    if (!isAlive(pid) || !/ai-memory/i.test(image(pid))) {
      out.stale.push(pid);
      forget(list);
      continue;
    }
    if (identity.port && (await probe(identity))) {
      out.adopted = { pid };
      continue;
    }
    await end(pid);
    out.killed.push(pid);
    forget(list);
  }
  return out;
}
// What a human should do about a start failure.
function explainStartError(log, dir) {
  const m = /another ai-memory serve process appears to be using[^\n]*?pid=(\d+)/i.exec(log || '');
  if (m)
    return (
      'Outro processo do AI Memory (pid ' +
      m[1] +
      ') está usando a pasta de memória e não respondeu. O VeSTA tentou liberá-la sozinho; se a mensagem voltar, feche o ai-memory.exe desse pid e reabra o VeSTA.'
    );
  return String(log || '')
    .trim()
    .split('\n')
    .pop();
}
// Ends a previous run's server by the pid VeSTA recorded, only when that pid is still an ai-memory process.
async function stopStale(dataDir) {
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(path.join(dataDir, 'memory', 'vesta-server.pid'), 'utf8').trim()) || 0;
  } catch {}
  if (pid > 0 && alive(pid) && /ai-memory/i.test(imageOf(pid))) await killPid(pid);
}
module.exports = {
  identityFile,
  readIdentity,
  writeIdentity,
  alive,
  imageOf,
  killPid,
  healthy,
  reclaim,
  explainStartError,
  stopStale,
};
