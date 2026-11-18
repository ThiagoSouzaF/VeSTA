// Skills each AI already has on this computer (Skills → Na sua IA). Read only: VeSTA never writes in ~/.claude,
// ~/.codex or a project's .claude folder.
//   Claude Code: ~/.claude/skills, the installed plugins (~/.claude/plugins/cache, newest version of each) and the
//                .claude/skills folder of each project connected to VeSTA.
//   Codex:       ~/.codex/skills (including .system) and its plugins (~/.codex/plugins/cache).
// OpenCode reaches models through their APIs: it has no skills folder of its own here.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const F = require('./format.cjs');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build']);
const HEAD_BYTES = 8192;

// Every SKILL.md under `dir`, at most `depth` folders down.
function findSkills(dir, depth, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
    out.push(path.join(dir, 'SKILL.md'));
    return out;
  }
  if (depth <= 0) return out;
  for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name)) findSkills(path.join(dir, e.name), depth - 1, out);
  return out;
}
function head(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
const subdirs = (dir) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
};
const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};
// <cache>/<marketplace>/<plugin>/<version>/...: only the newest version of each plugin counts.
function pluginRoots(cache) {
  const out = [];
  for (const market of subdirs(cache))
    for (const plugin of subdirs(market)) {
      const newest = subdirs(plugin).sort((a, b) => mtime(b) - mtime(a))[0];
      if (newest) out.push({ dir: newest, label: 'plugin ' + path.basename(plugin) });
    }
  return out;
}
function items(provider, roots, depth) {
  const out = [];
  for (const { dir, label } of roots)
    for (const file of findSkills(dir, depth)) {
      try {
        const { data } = F.parseSkill(head(file));
        const name = F.skillName(data, path.basename(path.dirname(file)));
        if (!name) continue;
        out.push({
          provider,
          name,
          description: String(data.description || '').slice(0, 400),
          label,
          dir: path.dirname(file),
        });
      } catch {}
    }
  // The same skill reached twice (a synced copy, two plugin roots): listed once.
  const seen = new Set();
  return out.filter((s) => !seen.has(s.name + '|' + s.label) && seen.add(s.name + '|' + s.label));
}

// -> { claude: [...], codex: [...], opencode: [] }; each item { provider, name, description, label, dir }.
function scanNative({ env = process.env, home = os.homedir(), projects = [] } = {}) {
  const claudeHome = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  const claudeRoots = [
    { dir: path.join(claudeHome, 'skills'), label: '~/.claude/skills' },
    ...pluginRoots(path.join(claudeHome, 'plugins', 'cache')),
    ...projects
      .filter((p) => p?.path)
      .map((p) => ({ dir: path.join(p.path, '.claude', 'skills'), label: 'projeto ' + p.name })),
  ];
  const codexRoots = [
    { dir: path.join(codexHome, 'skills'), label: '~/.codex/skills' },
    ...pluginRoots(path.join(codexHome, 'plugins', 'cache')),
  ];
  return { claude: items('claude', claudeRoots, 4), codex: items('codex', codexRoots, 4), opencode: [] };
}

module.exports = { scanNative, findSkills };
