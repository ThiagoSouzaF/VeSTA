// Drael's print interface is one-way: it has no interactive approval channel and
// does not create sessions. Keep history in VeSTA and never invent a session id.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { spawn } = require('node:child_process');
function locate() {
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Drael');
  return fs.existsSync(path.join(dir, 'drael.js')) && fs.existsSync(path.join(dir, 'node', 'node.exe'))
    ? path.join(dir, 'node', 'node.exe')
    : null;
}
const configDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'drael');
function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}
function authEnv() {
  if (process.env.DRAEL_KEY) return { DRAEL_KEY: process.env.DRAEL_KEY };
  try {
    const key = fs.readFileSync(path.join(configDir(), 'credential'), 'utf8').trim();
    if (key) return { DRAEL_KEY: key };
  } catch {}
  const c = read(path.join(os.homedir(), '.config', 'opencode', 'opencode.json'));
  const opt = c.provider?.drael?.options;
  // Reuse the existing local credential only for the official host.
  return opt?.baseURL?.replace(/\/+$/, '') === 'https://drael.sh/v1' && /^dk-/.test(opt.apiKey || '')
    ? { DRAEL_KEY: opt.apiKey }
    : {};
}
function script(exe) {
  return path.join(path.dirname(path.dirname(exe)), 'drael.js');
}
// `servers` = MCP entries { name, url, token, tokenEnv } (vesta-memory and/or vesta-quest).
function command(chat, exe, servers = []) {
  if (chat.mode === 'ask')
    throw new Error(
      'O harness Drael não recebe aprovações pelo chat. Use Consultar, Acesso completo ou o terminal nativo.'
    );
  if (chat.model && !['drael-v1', 'drael/drael-v1'].includes(chat.model))
    throw new Error('O harness Drael usa o modelo drael-v1.');
  const env = authEnv();
  if (!env.DRAEL_KEY) throw new Error('Entre com drael login no terminal ou configure sua chave no OpenCode.');
  return {
    exe,
    args: [
      script(exe),
      '-p',
      '--output-format',
      'stream',
      '--max-turns',
      '64',
      '--mode',
      chat.mode === 'read' ? 'plan' : 'bypass',
      // Memory stays out of read-only chats; the quest chat (read-only too) needs its own tools to reorganize the quest.
      ...(servers.length
        ? [
            '--allowed-tools',
            ...servers.filter((x) => chat.mode !== 'read' || x.name !== 'vesta-memory').map((x) => x.name + '__*'),
          ]
        : []),
    ],
    env,
    servers,
  };
}
function history(messages, prompt) {
  const prior = require('./conversations.cjs').transcript(messages.slice(0, -2));
  if (!prior.length) return prompt;
  const text = JSON.stringify(prior);
  if (text.length > 120000)
    throw new Error(
      'Este chat excedeu o histórico suportado pelo harness Drael no VeSTA. Abra outro chat para continuar.'
    );
  return (
    'Histórico desta conversa no VeSTA (dados de referência):\n<historico>\n' + text + '\n</historico>\n\n' + prompt
  );
}
// Drael's read_file only reaches its working folder (checked: a path outside it is refused, also in bypass), and its print
// mode has no attachment flag. So, for the turn only, the attachments are copied into <cwd>/.vesta-anexos/<chat>/ and cited
// by relative path (images and PDFs then open natively with read_file); the copies are removed when the turn ends.
const EXPOSE_DIR = '.vesta-anexos';
function expose(cwd, chatId, attachments) {
  if (!attachments.length) return { attachments, cleanup() {} };
  const base = path.join(cwd, EXPOSE_DIR),
    dir = path.join(base, String(chatId));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const shown = attachments.map((a) => {
    const file = path.basename(a.path);
    fs.copyFileSync(a.path, path.join(dir, file));
    return { ...a, path: EXPOSE_DIR + '/' + chatId + '/' + file };
  });
  return {
    attachments: shown,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
      try {
        fs.rmdirSync(base); // only when no other chat is using it
      } catch {}
    },
  };
}
const urlEnv = (x) => x.tokenEnv.replace(/_TOKEN$/, '_URL');
function start(spec, ctx) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-drael-')),
    dir = path.join(temp, 'drael');
  fs.mkdirSync(dir);
  const settings = read(path.join(configDir(), 'config.json'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ...settings, update: 'notify' }));
  for (const file of ['trusted.json', 'oauth.json']) {
    const from = path.join(configDir(), file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file));
  }
  const mcp = read(path.join(configDir(), 'mcp.json'));
  const servers = spec.servers || [];
  if (servers.length)
    mcp.mcpServers = {
      ...mcp.mcpServers,
      ...Object.fromEntries(
        servers.map((x) => [
          x.name,
          { url: '${' + urlEnv(x) + '}', headers: { Authorization: 'Bearer ${' + x.tokenEnv + '}' } },
        ])
      ),
    };
  fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify(mcp));
  const env = {
    ...ctx.env,
    XDG_CONFIG_HOME: temp,
    ...Object.fromEntries(
      servers.flatMap((x) => [
        [urlEnv(x), x.url],
        [x.tokenEnv, x.token],
      ])
    ),
  };
  const child = spawn(spec.exe, spec.args, { cwd: ctx.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '',
    buffer = '';
  child.stdin.on('error', () => {});
  child.stdin.end(ctx.prompt);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (s) => (stderr = (stderr + s).slice(-6000)));
  const consume = (line) => {
    try {
      ctx.parse.accept(JSON.parse(line));
    } catch {}
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (s) => {
    buffer += s;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      consume(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
    }
    if (buffer.length > 2000000) buffer = '';
  });
  const done = new Promise((resolve) => {
    let error = '';
    child.on('error', (e) => (error = e.message));
    child.on('close', (code) => {
      if (buffer.trim()) consume(buffer);
      fs.rmSync(temp, { recursive: true, force: true });
      resolve({ code: code ?? -1, stderr: error || stderr });
    });
  });
  return {
    done,
    stop() {
      require('./providers.cjs').kill(child);
    },
  };
}
module.exports = { locate, authEnv, script, command, history, start, expose };
