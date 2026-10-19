const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { randomUUID } = require('node:crypto');
const providers = require('./providers.cjs');
const { UserError } = require('./errors.cjs');
const usage = require('./usage.cjs');
const { redact } = require('./memory.cjs');
const { discover } = require('./integrations.cjs');
const { send } = require('./send.cjs');
const { readCodexRateLimits } = require('./rate-limits.cjs');
const { openTerminal } = require('./terminal.cjs');
const { questMethods } = require('./quest-methods.cjs');
const { attachmentMethods } = require('./attachment-methods.cjs');
const { THEMES } = require('./store.cjs');
// Text zoom: 80%..160% in steps of 10%.
const clampFontScale = (v) => Math.min(1.6, Math.max(0.8, Math.round(v * 10) / 10));
async function inspectProject(ctx, id) {
  const p = ctx.project(id);
  if (!p) return [];
  const files = [],
    seen = new Set();
  const add = (base, name, label) => {
    const file = path.join(base, name);
    if (!seen.has(file) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      seen.add(file);
      files.push({ name: label || name, path: file });
    }
  };
  let dir = p.path;
  for (let i = 0; i < 20; i++) {
    for (const name of [
      'AGENTS.md',
      'AGENTS.override.md',
      'CLAUDE.md',
      '.claude/CLAUDE.md',
      'opencode.json',
      'opencode.jsonc',
    ])
      add(dir, name);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  add(path.join(os.homedir(), '.codex'), 'AGENTS.md', 'Codex · instruções globais');
  add(path.join(os.homedir(), '.claude'), 'CLAUDE.md', 'Claude · instruções globais');
  add(path.join(os.homedir(), '.config', 'opencode'), 'AGENTS.md', 'OpenCode · instruções globais');
  return files;
}
// Every renderer-callable operation. The IPC handler (and, later, a remote server) dispatches into this object.
function createMethods(ctx) {
  const { jobs, permissions, bounded, project, sync, state } = ctx;
  let lastCodexRead = 0;
  return {
    // The first call after the opening reuses the integrations probed while the splash was up.
    bootstrap: async () => {
      const probing = ctx.bootDiscovery;
      ctx.bootDiscovery = null;
      return { state: state(), integrations: await (probing || discover(ctx)), dataDir: ctx.app.getPath('userData') };
    },
    refreshConnections: () => discover(ctx),
    createChat: (input) => {
      if (input.projectId && !project(input.projectId)) throw new UserError('Projeto inválido');
      ctx.store.addChat(input);
      sync();
      return state();
    },
    renameChat: ({ id, title }) => {
      ctx.store.chat(id).title = bounded(title, 100).trim() || 'Novo chat';
      ctx.store.save();
      sync();
      return state();
    },
    deleteChat: ({ id }) => {
      if (jobs.has(id)) throw new UserError('Interrompa a resposta antes de excluir');
      ctx.store.state.chats = ctx.store.state.chats.filter((c) => c.id !== id);
      ctx.store.save();
      ctx.attachments?.removeChat(id);
      sync();
      return state();
    },
    switchProvider: ({ id, provider }) => {
      if (jobs.has(id)) throw new UserError('Aguarde a resposta terminar antes de trocar a IA');
      if (!ctx.integrations[provider]?.installed) throw new UserError('IA indisponível. Confira as Conexões.');
      const c = ctx.store.chat(id);
      if (require('./conversations.cjs').switchProvider(c, provider)) {
        ctx.store.save();
        sync();
      }
      return state();
    },
    updateChat: ({ id, model, mode }) => {
      if (jobs.has(id)) throw new UserError('Aguarde a resposta terminar para trocar o modelo');
      const c = ctx.store.chat(id);
      if (model !== undefined) c.model = bounded(model, 120).trim();
      if (c.provider === 'drael' && mode === 'ask')
        throw new UserError('Use Consultar, Acesso completo ou o terminal nativo do Drael');
      if (mode !== undefined) c.mode = providers.MODES.includes(mode) ? mode : 'edit';
      ctx.store.save();
      sync();
      return state();
    },
    send: (args) => send(ctx, args),
    usage: () => usage.summary(ctx.store.state.usage),
    // Reads what the CLIs can report without a chat turn (today: the Codex plan windows), then returns the summary.
    refreshUsage: async ({ force } = {}) => {
      const result = usage.summary(ctx.store.state.usage);
      const exe = ctx.integrations.codex?.exe || providers.locate('codex');
      if (process.env.VESTA_NO_USAGE_REFRESH === '1' || !exe || (!force && Date.now() - lastCodexRead < 15000))
        return result;
      lastCodexRead = Date.now();
      try {
        const r = await readCodexRateLimits(exe);
        if (usage.recordRateLimit(ctx.store.state.usage, { provider: 'codex', ...r, replace: true })) {
          ctx.store.save();
          sync();
        }
        return usage.summary(ctx.store.state.usage);
      } catch (e) {
        return { ...result, refreshError: { codex: redact(e.message).split(/\r?\n/)[0] } };
      }
    },
    stop: ({ chatId }) => {
      ctx.stopChat(chatId);
      return true;
    },
    ...questMethods(ctx),
    ...attachmentMethods(ctx),
    // Ends one background task of a running chat. Only Claude exposes this, and only while its process is alive.
    stopTask: ({ chatId, taskId }) => {
      const run = jobs.get(chatId)?.run;
      if (!run?.stopTask || !run.stopTask(String(taskId || '')))
        throw new UserError('Esta tarefa não pode mais ser interrompida');
      return true;
    },
    answerPermission: ({ id, decision }) => {
      if (!['once', 'always', 'deny'].includes(decision)) throw new UserError('Resposta inválida');
      if (!permissions.answer(id, decision)) throw new UserError('Este pedido já foi respondido ou expirou');
      return true;
    },
    addProject: async () => {
      const result = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Escolher projeto',
        properties: ['openDirectory'],
      });
      if (result.canceled) return null;
      const dir = fs.realpathSync(result.filePaths[0]);
      let p = ctx.store.state.projects.find((p) => p.path.toLowerCase() === dir.toLowerCase());
      if (!p) {
        p = { id: randomUUID(), name: path.basename(dir), path: dir, createdAt: Date.now() };
        ctx.store.state.projects.push(p);
        ctx.store.save();
        sync();
      }
      return p;
    },
    inspectProject: ({ id }) => inspectProject(ctx, id),
    saveSettings: (input) => {
      const s = ctx.store.state.settings;
      if (THEMES.includes(input.theme)) s.theme = input.theme;
      if (['ember', 'violet', 'mint', 'amber', 'rose'].includes(input.accent)) s.accent = input.accent;
      if (['none', 'ember', 'rain', 'inkrain', 'stream'].includes(input.background)) s.background = input.background;
      if (Number.isFinite(input.fontScale)) s.fontScale = clampFontScale(input.fontScale);
      for (const key of ['memoryEnabled', 'capture', 'memoryTools', 'mascot'])
        if (typeof input[key] === 'boolean') s[key] = input[key];
      ctx.store.save();
      sync();
      return state();
    },
    memoryStatus: async () => {
      try {
        await ctx.memory.call('memory_status', { workspace: 'vesta', project: 'inbox' });
        return {
          connected: true,
          version: '3.0.0',
          mode: 'Busca local (FTS)',
          dir: ctx.memory.dir,
          agents: ctx.store.state.settings.memoryTools !== false,
          endpoint: ctx.memory.endpoint?.mcp,
        };
      } catch (e) {
        return { connected: false, error: e.message, dir: ctx.memory.dir };
      }
    },
    saveMemory: async (input) => {
      const existing = input.id ? ctx.store.state.memories.find((n) => n.id === input.id) : null;
      const kind = existing?.kind || (['preference', 'note'].includes(input.kind) ? input.kind : 'note');
      const id = existing?.id || randomUUID();
      const note = {
        ...existing,
        id,
        path: existing?.path || (kind === 'preference' ? 'preferences/' : 'notas/') + id + '.md',
        kind,
        projectId: existing?.projectId || input.projectId || null,
        title: bounded(input.title, 120).trim(),
        body: redact(bounded(input.body, 30000)),
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      if (!note.title || !note.body.trim()) throw new UserError('Preencha título e conteúdo');
      if (note.projectId && !project(note.projectId)) throw new UserError('Projeto inválido');
      await ctx.memory.write(note);
      ctx.store.state.memories = ctx.store.state.memories.filter((n) => n.id !== id);
      ctx.store.state.memories.unshift(note);
      ctx.store.save();
      sync();
      return state();
    },
    deleteMemory: async ({ id }) => {
      const note = ctx.store.state.memories.find((n) => n.id === id);
      if (note) {
        await ctx.memory.remove(note);
        ctx.store.state.memories = ctx.store.state.memories.filter((n) => n.id !== id);
        ctx.store.save();
        sync();
      }
      return state();
    },
    searchMemory: ({ query, projectId }) => ctx.memory.query(bounded(query, 500), projectId),
    exportChat: async ({ id }) => {
      const chat = ctx.store.chat(id);
      const result = await ctx.dialog.showSaveDialog(ctx.win, {
        defaultPath: chat.title.replace(/[<>:"/\\|?*]/g, '_') + '.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled) return false;
      fs.writeFileSync(
        result.filePath,
        '# ' +
          chat.title +
          '\n\n' +
          chat.messages
            .filter((m) => m.text)
            .map((m) => '## ' + (m.role === 'user' ? 'Você' : m.provider || chat.provider) + '\n\n' + m.text)
            .join('\n\n')
      );
      return true;
    },
    openProject: ({ id }) => {
      const p = project(id);
      if (!p) throw new UserError('Projeto inválido');
      return ctx.shell.openPath(p.path);
    },
    openInstructions: async ({ projectId, file }) => {
      const allowed = await inspectProject(ctx, projectId);
      if (!allowed.some((x) => x.path === file)) throw new UserError('Arquivo não autorizado');
      return ctx.shell.openPath(file);
    },
    openData: () => ctx.shell.openPath(ctx.app.getPath('userData')),
    openLink: ({ url }) => {
      const target = new URL(bounded(url, 3000));
      if (!['https:', 'http:'].includes(target.protocol)) throw new UserError('Link não suportado');
      return ctx.shell.openExternal(target.href);
    },
    openTerminal: (args) => openTerminal(ctx, args),
    checkUpdates: () => ctx.checkForUpdate({ interactive: true }),
    window: ({ action }) => {
      if (action === 'minimize') ctx.win.minimize();
      if (action === 'maximize') ctx.win.isMaximized() ? ctx.win.unmaximize() : ctx.win.maximize();
      if (action === 'close') ctx.win.close();
    },
  };
}
module.exports = { createMethods, clampFontScale };
