// Gemini CLI (`npm i -g @google/gemini-cli`): where it is, how it is started and what VeSTA hands it besides the chat.
// The CLI is a Node script (bundle/gemini.js), not an executable: `exe` in the integrations is that script and it runs
// with the node.exe of the same install. VeSTA talks to it over ACP (`gemini --acp`, see drivers/gemini.cjs).
//
// Gemini runs with a home folder of its own inside VeSTA's data (GEMINI_CLI_HOME = <dados>/gemini-home): its settings,
// login and sessions live there, chats and the native terminal share them, and ~/.gemini is neither read nor changed.
// Why not ~/.gemini plus a settings layer: the CLI skips a GEMINI_CLI_SYSTEM_SETTINGS_PATH file outside an
// admin-owned folder ("insecure"), and a Google login left in ~/.gemini wins over the key. In its own home:
//   - settings.json (the "user" layer): usage statistics, telemetry and self-update off; with a key, key auth and a
//     model the free tier serves. Keys the CLI itself writes there (a login from the terminal) are kept.
//   - policy(): a policy file (--policy) that lets VeSTA's own MCP servers (vesta-memory, vesta-quest, vesta-app) run
//     without a prompt, as Claude (--allowedTools) and Codex (default_tools_approval_mode) do.
//   - --skip-trust: the project folder is trusted for that session only. Without it Gemini forces every chat into
//     "ask" (it refuses full access in folders it does not trust) and ignores the project's GEMINI.md.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_NODE_DIR } = require('./providers/locate.cjs');
const { APP_SERVER, MEMORY_SERVER, QUEST_SERVER } = require('./providers/mcp-servers.cjs');
const { sealedFile } = require('../app/secrets.cjs');
const { UserError } = require('../app/errors.cjs');

const PACKAGE = path.join('node_modules', '@google', 'gemini-cli');
const SCRIPT = path.join(PACKAGE, 'bundle', 'gemini.js');

// Folders an `npm i -g` may have used: the Node.js install, %APPDATA%\npm, PATH and every nvm version (newest first).
function npmPrefixes() {
  const home = os.homedir();
  const nvmHome =
    process.env.NVM_HOME || path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'nvm');
  let nvm = [];
  try {
    nvm = fs
      .readdirSync(nvmHome)
      .filter((d) => /^v\d/.test(d))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((d) => path.join(nvmHome, d));
  } catch {}
  return [
    process.env.NODE_EXE ? path.dirname(process.env.NODE_EXE) : DEFAULT_NODE_DIR,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
    ...(process.env.PATH || '').split(path.delimiter),
    ...nvm,
  ].filter(Boolean);
}
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
// The CLI's script, or null when it is not installed.
function locate() {
  for (const dir of npmPrefixes()) {
    const p = path.join(dir, SCRIPT);
    if (isFile(p)) return p;
  }
  return null;
}
// The node.exe that runs it: the one next to its node_modules (Node.js install, nvm version), else the first on PATH.
function nodeFor(script) {
  const prefix = path.resolve(path.dirname(script), '..', '..', '..', '..');
  const candidates = [
    path.join(prefix, 'node.exe'),
    ...(process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, 'node.exe')),
    path.join(process.env.NODE_EXE ? path.dirname(process.env.NODE_EXE) : DEFAULT_NODE_DIR, 'node.exe'),
  ];
  return candidates.find(isFile) || null;
}
// What to spawn for `args`: { exe: node.exe, args: [script, ...args] }.
function launch(script, args = []) {
  const node = nodeFor(script);
  if (!node) throw new Error('O Gemini CLI precisa do Node.js, que não foi encontrado neste computador.');
  return { exe: node, args: [script, ...args] };
}

// Gemini's home inside VeSTA's data (see the top of this file).
const homeOf = (ctx) => path.join(ctx.app.getPath('userData'), 'gemini-home');

// Signed in: a saved key, a key in the environment or a Google login made in VeSTA's Gemini home.
function authenticated(ctx, env = process.env) {
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || hasKey(ctx)) return true;
  return !!ctx?.app && isFile(path.join(homeOf(ctx), '.gemini', 'oauth_creds.json'));
}

// The person's Gemini API key (Google AI Studio), saved from Conexões. Google no longer lets personal accounts use the
// CLI through "Login with Google" (it answers "This client is no longer supported…"), so the key is the way in.
// Sealed by the OS keychain in a file of its own like the backup password: never in vesta.json (so never in a backup),
// never on a command line, never in ~/.gemini.
const apiKey = (ctx) => sealedFile(path.join(ctx.app.getPath('userData'), 'gemini-key.json'), ctx.secrets);
// Keys come as "AIza…" (older) or "AQ.…" (AI Studio since 2026, with dots).
const KEY_PATTERN = /^[\w.-]{30,200}$/;
// AI Studio's quick start hands out a curl command with the key in a header (X-goog-api-key: …) or in ?key=…:
// pasting the whole command works too.
const IN_SNIPPET = /(?:x-goog-api-key:\s*|[?&]key=|GEMINI_API_KEY\s*=\s*["']?)([\w.-]{30,200})/i;
function keyFrom(text) {
  const value = String(text || '').trim();
  return KEY_PATTERN.test(value) ? value : IN_SNIPPET.exec(value)?.[1] || '';
}
function saveKey(ctx, key) {
  const value = keyFrom(key);
  if (!value) throw new UserError('Isso não parece uma chave do Gemini. Copie a chave inteira do Google AI Studio.');
  apiKey(ctx).set(value);
}
const hasKey = (ctx) => !!ctx?.secrets && apiKey(ctx).has();

// The models the picker offers (checked against a new AI Studio key, 2026-11). Google closed the 2.5 models to new
// keys, and the free tier gives Pro, "latest Pro" and Gemini 4 a quota of 0: only the Flash ones answer without billing.
// The CLI's "auto" routes to those paid models, so with a key the default ("Padrão da conta") is Flash-Lite instead.
const FREE_MODEL = 'gemini-3.1-flash-lite';
const MODELS = [FREE_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-pro-latest', 'gemini-4-argon'];

const PRIVATE_SETTINGS = {
  privacy: { usageStatisticsEnabled: false },
  telemetry: { enabled: false, logPrompts: false },
  // The CLI retries a busy (503) or over-quota (429) model up to 10 times, 30 s apart, silently: a chat looked frozen.
  // 3 attempts still ride out a blip, then the error reaches the chat.
  general: { enableAutoUpdate: false, enableAutoUpdateNotification: false, maxAttempts: 3 },
};
// The ids VeSTA's MCP servers have in Gemini's policy engine. A rule needs a toolName ("*" = every tool of the server).
const OWN_SERVERS = [MEMORY_SERVER, QUEST_SERVER, APP_SERVER];
const POLICY =
  '# Written by VeSTA for each launch: its own MCP servers run without asking.\n' +
  OWN_SERVERS.map((name) => `[[rule]]\nmcpName = "${name}"\ntoolName = "*"\ndecision = "allow"\npriority = 900\n`).join(
    '\n'
  );

const write = (file, content) => {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return file;
  } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};
// The policy file goes to a folder of VeSTA's own in the temp dir: its content never changes.
const policy = (dir = path.join(os.tmpdir(), 'vesta-gemini')) => write(path.join(dir, 'vesta-policy.toml'), POLICY);

// settings.json in Gemini's home: VeSTA's privacy on top of what is there (a login the CLI saved, a model the person
// picked in the terminal). With a key: key auth, and the free-tier model when no model was chosen.
function settingsFor(current = {}, withKey = false) {
  const next = { ...current };
  for (const [group, values] of Object.entries(PRIVATE_SETTINGS)) next[group] = { ...current[group], ...values };
  if (withKey) {
    next.security = { ...current.security, auth: { ...current.security?.auth, selectedType: 'gemini-api-key' } };
    next.model = { name: FREE_MODEL, ...current.model };
  }
  return next;
}
function writeSettings(ctx, withKey) {
  const file = path.join(homeOf(ctx), '.gemini', 'settings.json');
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return write(file, JSON.stringify(settingsFor(current, withKey), null, 2));
}
// What a chat or the native terminal adds to the environment: Gemini's home (settings written first) and the saved key.
function authEnv(ctx) {
  if (!ctx?.app) return {};
  const key = ctx.secrets ? apiKey(ctx).get() : '';
  writeSettings(ctx, !!key);
  return { GEMINI_CLI_HOME: homeOf(ctx), ...(key ? { GEMINI_API_KEY: key } : {}) };
}

module.exports = {
  locate,
  nodeFor,
  launch,
  homeOf,
  authenticated,
  apiKey,
  saveKey,
  keyFrom,
  hasKey,
  authEnv,
  settingsFor,
  MODELS,
  FREE_MODEL,
  OWN_SERVERS,
  POLICY,
  PRIVATE_SETTINGS,
  policy,
};
