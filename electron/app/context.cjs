const { UserError } = require('./errors.cjs');
const follow = require('../chat/follow.cjs');
const tasks = require('../shared/tasks.cjs');
const fs = require('node:fs'),
  path = require('node:path');
// Shared state of the main process. `store`, `memory` and `win` are filled in once the app is ready.
function createContext({ app, dialog, shell, bus }) {
  let markReady;
  const ctx = {
    app,
    // Resolves once the store and the other services exist: the first calls of the interface wait for it.
    ready: new Promise((resolve) => (markReady = resolve)),
    markReady: () => markReady(),
    dialog,
    shell,
    bus,
    win: null,
    store: null,
    memory: null,
    permissions: null,
    jobs: new Map(),
    // Chats whose Claude process stays alive for background commands: see follow.cjs.
    follows: follow.createFollows({
      settings: () => ctx.store.state.settings,
      onExpire: (id) => ctx.endFollowing(id, 'timeout'),
    }),
    integrations: {},
    emit: (event) => bus.emit(event),
    bounded: (value, max = 20000) => String(value || '').slice(0, max),
    project: (id) => ctx.store.state.projects.find((p) => p.id === id),
    // The remote-control config (device hashes) stays in the main process.
    state: () => {
      const { remote, ...rest } = ctx.store.state;
      return {
        ...rest,
        running: [...ctx.jobs.keys()],
        following: ctx.follows.snapshot(),
        appVersion: app.getVersion(),
      };
    },
    sync: () => bus.emit({ type: 'state', state: ctx.state() }),
    // Interrupts a running response (used by the Stop button and by quests).
    stopChat(chatId) {
      const task = ctx.jobs.get(chatId);
      if (!task) return ctx.endFollowing(chatId, 'user');
      task.cancelled = true;
      ctx.permissions?.cancelChat(chatId);
      task.run?.stop();
      return true;
    },
    // Ends one background task of a running chat (Claude only, while its process is alive). True when it was ended.
    stopTask(chatId, taskId) {
      const run = ctx.jobs.get(chatId)?.run || ctx.follows.get(chatId)?.run;
      return !!(run?.stopTask && run.stopTask(String(taskId || '')));
    },
    // Stops following a chat: claude.exe is closed (never its process tree), the user's processes keep running.
    // reason: 'user' | 'timeout' | 'ended' (the process died) | 'quit' (app closing) | 'silent' (chat deleted/changed).
    endFollowing(chatId, reason = 'user') {
      const session = ctx.follows.drop(chatId);
      if (!session) return false;
      session.phase = 'closed';
      session.run?.stopFollowing?.({ immediate: reason === 'quit' });
      const chat = ctx.store?.state.chats.find((c) => c.id === chatId);
      if (chat) {
        tasks.detachRunning(chat);
        const minutes = follow.limits(ctx.store.state.settings).minutes;
        const text =
          reason === 'timeout'
            ? follow.timeoutNotice(minutes)
            : reason === 'ended'
              ? follow.endedNotice()
              : reason === 'user'
                ? follow.stoppedNotice()
                : '';
        if (text) chat.notice = { text, at: Date.now(), reason };
        if (reason !== 'quit') {
          ctx.store.save();
          ctx.sync();
        }
      }
      return true;
    },
    workdir(chat) {
      const dir = chat.projectId ? ctx.project(chat.projectId)?.path : path.join(app.getPath('userData'), 'workspace');
      if (!dir) throw new UserError('O projeto deste chat não existe mais');
      if (!chat.projectId) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        throw new UserError('A pasta do projeto não está disponível');
      return dir;
    },
  };
  return ctx;
}
module.exports = { createContext };
