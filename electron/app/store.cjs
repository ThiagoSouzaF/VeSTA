const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UserError } = require('./errors.cjs');
const { emptyUsage, migrate } = require('../ai/usage.cjs');
const { normalizeQuests, PROVIDER_IDS } = require('../shared/quests.cjs');
const { defaultRemote, normalizeRemote } = require('../remote/index.cjs');
const { writeAtomic } = require('../util/sys.cjs');
// Bump when a one-time migration is added below.
const STORE_VERSION = 6;
const THEMES = ['ink', 'obsidian', 'aurora', 'paper'];
const defaults = () => ({
  version: STORE_VERSION,
  settings: {
    theme: 'ink',
    accent: 'ember',
    background: 'rain',
    memoryEnabled: true,
    capture: true,
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
  // Agent Mode (see shared/agents.cjs): named jobs an AI does on its own, on a schedule or on request.
  agents: [],
  // Equipes (see shared/teams.cjs): agents that work together on a project, with a board and messages.
  teams: [],
  // Consolidation of the shared memory by an AI the person picks (memory/consolidator.cjs): the AI, the schedule,
  // the last runs, and the closed conversation stretches waiting for it.
  consolidation: null,
  // Refino automático (refine/auto.cjs): the AI, the schedule and the last reviews of skills and agents.
  refineAuto: null,
  memoryToConsolidate: [],
  usage: emptyUsage(),
  remote: defaultRemote(),
  // Preferências → Backup (see backup.cjs): destination, schedule and the result of the last run.
  backup: { folder: '', auto: 'daily', keep: 10 },
});
// One-time upgrades, keyed by the version a store file was saved with. Mutates and returns `state`.
// v4: "Tinta Mangá" became the default theme, so existing installs move to it once; their later choice is respected.
// v5: Gemini left VeSTA (0.19): its chats go away, and quests forget them (their steps already fall back to Claude).
// v6: the AI Memory server no longer consolidates with the Codex login (0.26): an AI picked in the Memória screen does,
//     on its schedule. The old switch goes; with it off, the schedule starts as "only when asked".
function migrateStore(state, savedVersion) {
  if (savedVersion < 4) state.settings.theme = 'ink';
  if (savedVersion < 6) {
    if (state.settings.memoryConsolidate === 'off' && !state.consolidation)
      state.consolidation = { schedule: { kind: 'manual' } };
    delete state.settings.memoryConsolidate;
  }
  if (savedVersion < 5 && Array.isArray(state.chats)) {
    const gone = new Set(state.chats.filter((c) => c.provider === 'gemini').map((c) => c.id));
    state.chats = state.chats.filter((c) => !gone.has(c.id));
    for (const q of state.quests || []) {
      if (gone.has(q.leadChatId)) q.leadChatId = null;
      for (const st of q.steps || []) if (gone.has(st.chatId)) st.chatId = null;
    }
  }
  return state;
}
const SAVE_DELAY_MS = 300;
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
          usage: migrate({ ...this.state.usage, ...saved.usage, daily: { ...saved.usage?.daily }, v: saved.usage?.v }),
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
  // Writes the whole state now (and whatever saveSoon had pending). Compact JSON: the file holds every conversation, so
  // indentation only made each write bigger and slower; the readable copy lives in the backups.
  save() {
    clearTimeout(this.pendingSave);
    this.pendingSave = null;
    writeAtomic(this.file, JSON.stringify(this.state));
  }
  // The hot path of a turn (start, end, permission answers) saves several times per message: those writes are merged
  // into one within SAVE_DELAY_MS, and one still pending is written when the process exits.
  saveSoon() {
    if (this.pendingSave) return;
    this.pendingSave = setTimeout(() => this.save(), SAVE_DELAY_MS);
    if (!this.flushOnExit) {
      this.flushOnExit = () => this.pendingSave && this.save();
      process.once('exit', this.flushOnExit);
    }
  }
  chat(id) {
    const c = this.state.chats.find((c) => c.id === id);
    if (!c) throw new UserError('Chat não encontrado');
    return c;
  }
  addChat(input) {
    if (!PROVIDER_IDS.includes(input.provider)) throw new UserError('IA inválida');
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
