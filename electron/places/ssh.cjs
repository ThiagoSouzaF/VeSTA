// SSH to a place (a VPS): the person's own ssh, with the keys they already use (~/.ssh, their agent). VeSTA keeps no
// password: BatchMode makes ssh fail instead of asking. A host seen for the first time is remembered
// (StrictHostKeyChecking=accept-new); a host whose key changed is refused by ssh itself.
// Every command runs in a login shell (sh -lc) so the PATH is the one the person has when they log in.
const fs = require('node:fs'),
  path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');
const { childEnv } = require('../app/privacy.cjs');
const { sshLine } = require('../shared/places.cjs');

// One argument for a POSIX shell, in single quotes.
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
// user@host, host or an alias of ~/.ssh/config; nothing that ssh could read as an option.
const HOST = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$|^(?:[A-Za-z0-9._-]+@)?\[[0-9A-Fa-f:.]+\]$/;
function checkTarget({ host, port }) {
  const h = String(host || '').trim();
  if (!HOST.test(h)) throw new Error('Endereço inválido: use usuario@servidor (ou um nome do ~/.ssh/config)');
  const p = Number(port || 22);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Porta inválida');
  return { host: h, port: p };
}

// The ssh program: VESTA_SSH ({ exe, args } as JSON, tests) or Windows' own OpenSSH, else the one in the PATH.
function sshProgram() {
  if (process.env.VESTA_SSH) return JSON.parse(process.env.VESTA_SSH);
  if (process.platform === 'win32') {
    const own = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    if (fs.existsSync(own)) return { exe: own, args: [] };
  }
  return { exe: 'ssh', args: [] };
}
const OPTIONS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'StrictHostKeyChecking=accept-new',
  '-o',
  'ServerAliveInterval=15',
];

// sh(target, script, { stdin, timeoutMs }) -> { code, out, err }; never throws for a failing command, only resolves.
function createSsh({ program = sshProgram(), spawn = nodeSpawn } = {}) {
  return function sh(target, script, { stdin = '', timeoutMs = 30000 } = {}) {
    const { host, port } = checkTarget(target);
    const args = [...(program.args || []), ...OPTIONS, '-p', String(port), host, 'sh -lc ' + q(script)];
    return new Promise((resolve) => {
      let out = '',
        err = '',
        done = false;
      const child = spawn(program.exe, args, { windowsHide: true, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      const finish = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ code: -1, out, err: 'Sem resposta em ' + Math.round(timeoutMs / 1000) + ' s' });
      }, timeoutMs);
      child.stdout.on('data', (d) => out.length < 16 * 1024 * 1024 && (out += d));
      child.stderr.on('data', (d) => err.length < 64000 && (err += d));
      child.on('error', (e) => finish({ code: -1, out, err: e.message }));
      child.on('close', (code) => finish({ code, out, err }));
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
    });
  };
}
// The last lines of what ssh said, for an error the person can read ("Permission denied (publickey)").
const sshError = (r) =>
  (
    String(r.err || '')
      .trim()
      .split(/\r?\n/)
      .filter((l) => !/^Warning: Permanently added/.test(l))
      .slice(-2)
      .join(' ') || 'Saiu com código ' + r.code
  ).slice(0, 300);

// ---- What the machine has ------------------------------------------------------------------------------------------
const PROBE = [
  'echo "home=$HOME"',
  'echo "user=$(id -un 2>/dev/null)"',
  'echo "uname=$(uname -s 2>/dev/null) $(uname -m 2>/dev/null)"',
  'if [ -r /etc/os-release ]; then (. /etc/os-release; echo "distro=$PRETTY_NAME"); fi',
  'echo "node=$(command -v node)"',
  'if command -v node >/dev/null 2>&1; then echo "nodever=$(node --version)"; fi',
  'echo "path=$PATH"',
  'for a in claude codex opencode; do echo "ai.$a=$(command -v $a)"; done',
  'if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then echo systemd=1; fi',
  'if command -v loginctl >/dev/null 2>&1; then echo "linger=$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)"; fi',
].join('\n');
const MIN_NODE = 18;
// The probe's output as a description of the place (and why it cannot be one: problem).
function readProbe(out) {
  const kv = {};
  for (const line of String(out).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    else if (line.trim() === 'systemd=1') kv.systemd = '1';
  }
  const major =
    Number(
      String(kv.nodever || '')
        .replace(/^v/, '')
        .split('.')[0]
    ) || 0;
  const ais = {};
  for (const id of ['claude', 'codex', 'opencode']) if (kv['ai.' + id]) ais[id] = { exe: kv['ai.' + id] };
  const os = kv.distro || kv.uname || 'Linux';
  const scheduler = kv.systemd === '1' ? 'systemd' : 'none';
  return {
    home: kv.home || '',
    user: kv.user || '',
    os,
    kind: os + ' · ' + (scheduler === 'systemd' ? 'systemd' : 'sem agendador'),
    node: kv.node || '',
    nodeVersion: kv.nodever || '',
    path: kv.path || '',
    ais,
    scheduler,
    linger: kv.linger ? kv.linger === 'yes' : null,
    problem: !kv.home
      ? 'O servidor não disse qual é a pasta do usuário'
      : !kv.node
        ? 'Node não encontrado no servidor (instale o Node ' + MIN_NODE + ' ou mais)'
        : major < MIN_NODE
          ? 'Node ' + kv.nodever + ' é antigo: precisa do ' + MIN_NODE + ' ou mais'
          : '',
  };
}

module.exports = { createSsh, sshProgram, checkTarget, sshLine, sshError, q, PROBE, readProbe, MIN_NODE };
