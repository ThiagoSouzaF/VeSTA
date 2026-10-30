const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UserError } = require('./errors.cjs');
const { emptyUsage, migrate } = require('../ai/usage.cjs');
const { normalizeQuests } = require('../shared/quests.cjs');
const { defaultRemote, normalizeRemote } = require('../remote/index.cjs');
const { writeAtomic } = require('../util/sys.cjs');
// Bump when a one-time migration is added below.
const STORE_VERSION = 4;
const THEMES = ['ink', 'obsidian', 'aurora', 'paper'];
const defaults = () => ({
  version: STORE_VERSION,
  settings: {
    theme: 'ink',
    accent: 'ember',
    background: 'rain',
    memoryEnabled: true,
    capture: true,
    // Consolidation of finished conversation stretches by an LLM ('codex' reuses the Codex CLI login, 'off' = none).
    memoryConsolidate: 'codex',
    // Old behaviour: one raw page per answer (conversas/<chat>/<msg>.md). Off: conversations become sessions instead.
    captureRaw: false,
    memoryTools: true,
    // Chats can see and change these preferences through the vesta-app MCP server (app-mcp.cjs).
    chatSettings: true,
    // Look for a new release on GitHub when the app opens (Preferências → Atualizações).
    autoUpdate: true,
    // Following Claude chats whose background commands outlive the turn (see follow.cjs).
    followMinutes: 120,
    followMax: 3,
    density: 'comfortable',
    fontScale: 1,
  },
  projects: [],
  chats: [],
  memories: [],
  quests: [],
  usage: emptyUsage(),
  remote: defaultRemote(),
  // Preferências → Backup (see backup.cjs): destination, schedule and the result of the last run.
  backup: { folder: '', auto: 'daily', keep: 10 },
});
// One-time upgrades, keyed by the version a store file was saved with. Mutates and returns `state`.
// v4: "Tinta Mangá" became the default theme, so existing installs move to it once; their later choice is respected.
function migrateStore(state, savedVersion) {
  if (savedVersion < 4) state.settings.theme = 'ink';
  return state;
}
class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'vesta.json');
    fs.mkdirSync(dir, { recursive: true });
    this.state = defaults();
    if (fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.state = {
          ...this.state,
          ...saved,
          settings: { ...this.state.settings, ...saved.settings },
          usage: migrate({ ...this.state.usage, ...saved.usage, daily: { ...saved.usage?.daily } }),
          quests: normalizeQuests(saved.quests),
          remote: normalizeRemote(saved.remote),
          backup: { ...this.state.backup, ...saved.backup },
          version: STORE_VERSION,
        };
        const from = saved.version || 1;
        if (from < 2) for (const c of this.state.chats) c.mode = 'edit';
        if (from < STORE_VERSION) {
          migrateStore(this.state, from);
          this.save();
        }
      } catch (err) {
        throw new Error('Os dados do VeSTA não puderam ser lidos. O arquivo original foi preservado. ' + err.message);
      }
    }
  }
  save() {
    writeAtomic(this.file, JSON.stringify(this.state, null, 2));
  }
  chat(id) {
    const c = this.state.chats.find((c) => c.id === id);
    if (!c) throw new UserError('Chat não encontrado');
    return c;
  }
  addChat(input) {
    if (!['codex', 'claude', 'drael', 'opencode'].includes(input.provider)) throw new UserError('IA inválida');
    const c = {
      id: randomUUID(),
      title: 'Novo chat',
      provider: input.provider,
      model: input.model || '',
      agent: input.agent || '',
      projectId: input.projectId || null,
      mode: ['read', 'ask'].includes(input.mode) ? input.mode : 'edit',
      messages: [],
      sessionId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      memory: input.memory !== false,
    };
    this.state.chats.unshift(c);
    this.save();
    return c;
  }
}
module.exports = { Store, defaults, migrateStore, STORE_VERSION, THEMES };
