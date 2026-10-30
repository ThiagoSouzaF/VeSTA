// Chat operations of the renderer API: create/rename/delete, provider and model switch, send/stop, usage, export and
// the answers to a following chat or a permission request.
const fs = require('node:fs');
const providers = require('../ai/providers.cjs');
const usage = require('../ai/usage.cjs');
const { redact } = require('../memory/redact.cjs');
const { readCodexRateLimits } = require('../ai/rate-limits.cjs');
const { UserError } = require('../app/errors.cjs');
const { send } = require('./send.cjs');
const conversations = require('./conversations.cjs');
function chatMethods(ctx) {
  const { jobs, permissions, bounded, project, sync, state } = ctx;
  let lastCodexRead = 0;
  return {
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
      ctx.endFollowing?.(id, 'silent');
      const session = ctx.store.state.chats.find((c) => c.id === id)?.memorySession;
      ctx.store.state.chats = ctx.store.state.chats.filter((c) => c.id !== id);
      ctx.store.save();
      ctx.attachments?.removeChat(id);
      ctx.memorySessions?.forget(id, session);
      sync();
      return state();
    },
    switchProvider: ({ id, provider }) => {
      if (jobs.has(id)) throw new UserError('Aguarde a resposta terminar antes de trocar a IA');
      if (!ctx.integrations[provider]?.installed) throw new UserError('IA indisponível. Confira as Conexões.');
      const c = ctx.store.chat(id);
      const from = c.provider;
      if (c.provider !== provider) ctx.endFollowing?.(id, 'silent');
      if (conversations.switchProvider(c, provider)) {
        // The next AI also finds a short handoff in the shared memory (besides the history VeSTA sends it).
        ctx.memorySessions?.handoffOnSwitch?.(c, from);
        ctx.store.save();
        sync();
      }
      return state();
    },
    updateChat: ({ id, model, mode }) => {
      if (jobs.has(id)) throw new UserError('Aguarde a resposta terminar para trocar o modelo');
      const c = ctx.store.chat(id);
      ctx.endFollowing?.(id, 'silent');
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
    // Ends the following of a chat (claude.exe closes; the background processes keep running).
    stopFollowing: ({ chatId }) => {
      if (!ctx.endFollowing(chatId, 'user')) throw new UserError('Este chat não está sendo acompanhado');
      return state();
    },
    // Ends one background task of a running chat. Only Claude exposes this, and only while its process is alive.
    stopTask: ({ chatId, taskId }) => {
      if (!ctx.stopTask(chatId, taskId)) throw new UserError('Esta tarefa não pode mais ser interrompida');
      return true;
    },
    answerPermission: ({ id, decision }) => {
      if (!['once', 'always', 'deny'].includes(decision)) throw new UserError('Resposta inválida');
      if (!permissions.answer(id, decision)) throw new UserError('Este pedido já foi respondido ou expirou');
      return true;
    },
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
  };
}
module.exports = { chatMethods };
