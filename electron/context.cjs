const { UserError } = require('./errors.cjs');
const fs = require('node:fs'),
  path = require('node:path');
// Shared state of the main process. `store`, `memory` and `win` are filled in once the app is ready.
function createContext({ app, dialog, shell, bus }) {
  const ctx = {
    app,
    dialog,
    shell,
    bus,
    win: null,
    store: null,
    memory: null,
    permissions: null,
    jobs: new Map(),
    integrations: {},
    emit: (event) => bus.emit(event),
    bounded: (value, max = 20000) => String(value || '').slice(0, max),
    project: (id) => ctx.store.state.projects.find((p) => p.id === id),
    // The remote-control config (device hashes) stays in the main process.
    state: () => {
      const { remote, ...rest } = ctx.store.state;
      return { ...rest, running: [...ctx.jobs.keys()], appVersion: app.getVersion() };
    },
    sync: () => bus.emit({ type: 'state', state: ctx.state() }),
    // Interrupts a running response (used by the Stop button and by quests).
    stopChat(chatId) {
      const task = ctx.jobs.get(chatId);
      if (!task) return false;
      task.cancelled = true;
      ctx.permissions?.cancelChat(chatId);
      task.run?.stop();
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
