// Tailscale CLI integration: detection, status and the `tailscale serve` command (HTTPS inside the tailnet).
// The commands are built as argument lists (no shell). Tests only exercise detection and command construction.
const fs = require('node:fs'),
  path = require('node:path');
const { execFile } = require('node:child_process');
const { isTailscaleIp: isCgnat } = require('./net.cjs');

// Where the CLI is looked up, in this order: the official absolute install path first, the PATH only as a last resort
// (a tailscale.exe planted in a PATH folder must not win over the real one).
function findCli({ env = process.env, exists = fs.existsSync, platform = process.platform } = {}) {
  const win = platform === 'win32';
  const name = win ? 'tailscale.exe' : 'tailscale';
  const official = win
    ? [env.ProgramFiles, env.ProgramW6432, 'C:\\Program Files']
        .filter(Boolean)
        .map((dir) => path.win32.join(dir, 'Tailscale', 'tailscale.exe'))
    : platform === 'darwin'
      ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale']
      : ['/usr/bin/tailscale', '/usr/local/bin/tailscale'];
  const found = official.find((f) => exists(f));
  if (found) return found;
  for (const dir of String(env.PATH || env.Path || '')
    .split(path.delimiter)
    .filter(Boolean)) {
    const file = path.join(dir, name);
    if (exists(file)) return file;
  }
  return null;
}
const run = (exe, args, timeout = 6000) =>
  new Promise((resolve, reject) =>
    execFile(exe, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim().split(/\r?\n/)[0])) : resolve(stdout)
    )
  );
const serveArgs = (port) => ['serve', '--bg', '--https=443', 'http://127.0.0.1:' + port];
const unserveArgs = () => ['serve', '--https=443', 'off'];

// `tailscale status --json` -> { running, dnsName, ips }
function parseStatus(json) {
  const s = typeof json === 'string' ? JSON.parse(json) : json || {};
  return {
    running: s.BackendState === 'Running',
    backendState: s.BackendState || '',
    dnsName: String(s.Self?.DNSName || '').replace(/\.$/, ''),
    ips: s.Self?.TailscaleIPs || s.TailscaleIPs || [],
  };
}
const parseServeJson = (json) => {
  try {
    const s = typeof json === 'string' ? JSON.parse(json || '{}') : json || {};
    return s && typeof s === 'object' ? s : {};
  } catch {
    return null;
  }
};
function proxiesTo(proxy, port) {
  try {
    const u = new URL(String(proxy || ''));
    return (
      u.protocol === 'http:' &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
      Number(u.port) === Number(port) &&
      (u.pathname === '/' || u.pathname === '')
    );
  } catch {
    return false;
  }
}
// `tailscale serve status --json` -> who owns port 443 of this machine:
//   { state: 'free' }                      nothing is published on 443
//   { state: 'ours', url }                 443 proxies only to 127.0.0.1:<our port>
//   { state: 'foreign' }                   anything else (another proxy, a file/path handler, a TCP forward, our own
//                                          address with a different port, an unreadable answer): VeSTA must not touch it
function inspectServe(json, port) {
  const s = parseServeJson(json);
  if (!s) return { state: 'foreign' };
  let url = null,
    foreign = false;
  for (const [hostPort, web] of Object.entries(s.Web || {})) {
    if (!/:443$/.test(hostPort)) continue;
    const handlers = Object.values(web?.Handlers || {});
    if (!handlers.length) continue;
    if (handlers.every((h) => proxiesTo(h.Proxy, port))) url = 'https://' + hostPort.replace(/:443$/, '');
    else foreign = true;
  }
  if (s.TCP?.['443']?.TCPForward) foreign = true;
  return foreign ? { state: 'foreign' } : url ? { state: 'ours', url } : { state: 'free' };
}
// The https URL when 443 proxies to our port, otherwise null.
const parseServe = (json, port) => {
  const r = inspectServe(json, port);
  return r.state === 'ours' ? r.url : null;
};
async function status({ port, exe = findCli(), exec = run } = {}) {
  if (!exe) return { installed: false, running: false, serving: false, httpsUrl: null };
  const out = { installed: true, exe, running: false, serving: false, httpsUrl: null, dnsName: '', ips: [] };
  try {
    Object.assign(out, parseStatus(await exec(exe, ['status', '--json'])));
  } catch (e) {
    out.error = e.message;
    return out;
  }
  if (out.running) {
    // `tailscale status --json` normally carries the addresses; `tailscale ip -4` is the second opinion.
    if (!out.ips.some(isCgnat))
      try {
        out.ips = (await exec(exe, ['ip', '-4']))
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean);
      } catch {}
    try {
      const serveState = inspectServe(await exec(exe, ['serve', 'status', '--json']), port);
      out.serveState = serveState.state;
      out.httpsUrl = serveState.url || null;
      out.serving = serveState.state === 'ours';
    } catch {}
  }
  return out;
}
class ServeConflict extends Error {}
// Publishes the port with HTTPS, unless 443 already serves something that is not VeSTA's: then nothing is changed.
async function serve(port, { exe = findCli(), exec = run } = {}) {
  if (!exe) throw new Error('Tailscale não encontrado');
  const current = inspectServe(await exec(exe, ['serve', 'status', '--json']), port);
  if (current.state === 'foreign')
    throw new ServeConflict(
      'A porta 443 do seu Tailscale já está em uso por outra publicação ("tailscale serve"). O VeSTA não vai alterá-la. ' +
        'Para usar HTTPS aqui, desfaça a outra publicação ou use o endereço do Tailscale (100.x.x.x) sem HTTPS.'
    );
  if (current.state === 'ours') return { changed: false, url: current.url };
  await exec(exe, serveArgs(port), 20000);
  return { changed: true };
}
// Undoes the publication only when it is VeSTA's (proxy to our own port); someone else's configuration is never touched.
async function unserve(port, { exe = findCli(), exec = run } = {}) {
  if (!exe) throw new Error('Tailscale não encontrado');
  const current = inspectServe(await exec(exe, ['serve', 'status', '--json']), port);
  if (current.state !== 'ours') return { changed: false, state: current.state };
  await exec(exe, unserveArgs(), 20000);
  return { changed: true };
}
module.exports = {
  findCli,
  status,
  serve,
  unserve,
  serveArgs,
  unserveArgs,
  parseStatus,
  parseServe,
  inspectServe,
  ServeConflict,
};
