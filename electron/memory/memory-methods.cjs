// Memória screen of the renderer API: notes, standing preferences (profile), search and the server status.
const { randomUUID } = require('node:crypto');
const { redact } = require('./redact.cjs');
const { spoolCount } = require('./spool.cjs');
const { UserError } = require('../app/errors.cjs');
function memoryMethods(ctx) {
  const { bounded, project, sync, state } = ctx;
  return {
    memoryStatus: async () => {
      const { dir, mcp, spool } = ctx.memory.status();
      try {
        await ctx.memory.call('memory_status', { workspace: 'vesta', project: 'inbox' });
        return {
          connected: true,
          version: '3.0.0',
          mode: 'Busca local (FTS)',
          dir,
          agents: ctx.store.state.settings.memoryTools !== false,
          endpoint: mcp,
          spool: { pending: spoolCount(dir), last: spool },
          consolidation: {
            provider: ctx.store.state.settings.memoryConsolidate || 'off',
            open: ctx.store.state.chats.filter((c) => c.memorySession).length,
            last: ctx.memorySessions?.status.lastConsolidation || null,
            error: ctx.memorySessions?.status.lastError || null,
          },
        };
      } catch (e) {
        return {
          connected: false,
          error: e.message,
          dir,
          spool: { pending: spoolCount(dir), last: spool },
        };
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
    // Preferences the AIs learned (cross-project profile of the AI Memory), with where each one came from.
    profileList: async () => {
      const meta = ctx.store.state.profileMeta || {};
      const entries = await ctx.memory.profile();
      return entries.map((e) => ({ ...e, origin: meta[e.path] || null }));
    },
    saveProfile: async (input) => {
      const statement = bounded(input.statement, 2000).trim();
      if (!statement) throw new UserError('Escreva a preferência');
      const p = await ctx.memory.profileWrite({
        path: input.path ? bounded(input.path, 300) : '',
        category: bounded(input.category, 40),
        subject: bounded(input.subject || statement, 80),
        statement,
      });
      const meta = (ctx.store.state.profileMeta ||= {});
      meta[p] = { ...meta[p], provider: 'user', chatTitle: 'Tela Memória', at: Date.now() };
      ctx.store.save();
      sync();
      return ctx.memory.profile().then((list) => list.map((e) => ({ ...e, origin: meta[e.path] || null })));
    },
    deleteProfile: async ({ path: p }) => {
      await ctx.memory.profileRemove(bounded(p, 300));
      const meta = ctx.store.state.profileMeta || {};
      delete meta[String(p).startsWith('profile/') ? p : 'profile/' + p];
      ctx.store.save();
      sync();
      return true;
    },
    searchMemory: ({ query, projectId }) => ctx.memory.query(bounded(query, 500), projectId),
  };
}
module.exports = { memoryMethods };
