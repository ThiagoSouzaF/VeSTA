// Gemini CLI (`npm i -g @google/gemini-cli`): where it is, how it is started and what VeSTA hands it besides the chat.
// The CLI is a Node script (bundle/gemini.js), not an executable: `exe` in the integrations is that script and it runs
// with the node.exe of the same install. VeSTA talks to it over ACP (`gemini --acp`, see drivers/gemini.cjs).
//
// Everything VeSTA needs goes per launch, never into ~/.gemini:
//   - privateSettings(): a settings file passed as GEMINI_CLI_SYSTEM_SETTINGS_PATH (the highest-precedence layer) with
//     usage statistics, telemetry and self-update off. The person's own ~/.gemini/settings.json (login, model) stays.
//   - policy(): a policy file (--policy) that lets VeSTA's own MCP servers (vesta-memory, vesta-quest, vesta-app) run
//     without a prompt, as Claude (--allowedTools) and Codex (default_tools_approval_mode) do.
//   - --skip-trust: the project folder is trusted for that session only. Without it Gemini forces every chat into
//     "ask" (it refuses full access in folders it does not trust) and ignores the project's GEMINI.md.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_NODE_DIR } = require('./providers/locate.cjs');
const { APP_SERVER, MEMORY_SERVER, QUEST_SERVER } = require('./providers/mcp-servers.cjs');

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

// Signed in: Google login (oauth_creds.json) or an API key in the environment. null = cannot tell.
function authenticated(env = process.env, home = os.homedir()) {
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) return true;
  return isFile(path.join(home, '.gemini', 'oauth_creds.json'));
}

// The models the picker offers. "auto" lets the CLI route between Pro and Flash; any other id goes to `--model`.
const MODELS = ['auto', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const PRIVATE_SETTINGS = {
  privacy: { usageStatisticsEnabled: false },
  telemetry: { enabled: false, logPrompts: false },
  general: { enableAutoUpdate: false, enableAutoUpdateNotification: false },
};
// The ids VeSTA's MCP servers have in Gemini's policy engine.
const OWN_SERVERS = [MEMORY_SERVER, QUEST_SERVER, APP_SERVER];
const POLICY =
  '# Written by VeSTA for each launch: its own MCP servers run without asking.\n' +
  OWN_SERVERS.map((name) => `[[rule]]\nmcpName = "${name}"\ndecision = "allow"\npriority = 900\n`).join('\n');

// Files VeSTA hands the CLI, written (again) to a folder of its own in the temp dir: the content never changes.
function writeOnce(name, content, dir) {
  const file = path.join(dir, name);
  try {
    if (fs.readFileSync(file, 'utf8') === content) return file;
  } catch {}
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
const filesDir = () => path.join(os.tmpdir(), 'vesta-gemini');
const privateSettings = (dir = filesDir()) =>
  writeOnce('settings.json', JSON.stringify(PRIVATE_SETTINGS, null, 2), dir);
const policy = (dir = filesDir()) => writeOnce('vesta-policy.toml', POLICY, dir);

module.exports = {
  locate,
  nodeFor,
  launch,
  authenticated,
  MODELS,
  OWN_SERVERS,
  POLICY,
  PRIVATE_SETTINGS,
  privateSettings,
  policy,
};
