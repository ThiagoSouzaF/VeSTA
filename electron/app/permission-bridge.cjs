// Connects the permission requests of the agents (ai/permissions.cjs) to the app: the rules saved per chat, the
// request cards on the running answer, the event the screens draw, and a flashing taskbar when nobody is looking.
const { Permissions } = require('../ai/permissions.cjs');
const bg = require('./background-mode.cjs');

const MAX_PER_MESSAGE = 60;

function createPermissionBridge(ctx) {
  return new Permissions({
    rules: (chatId) => {
      const c = ctx.store.state.chats.find((x) => x.id === chatId);
      if (!c) return null;
      c.permissionRules = c.permissionRules || [];
      return c.permissionRules;
    },
    onUpdate: (chatId, record) => {
      const msg = ctx.jobs.get(chatId)?.assistant;
      if (msg) {
        msg.permissions = msg.permissions || [];
        const i = msg.permissions.findIndex((x) => x.id === record.id);
        if (i >= 0) msg.permissions[i] = { ...record };
        else msg.permissions.push({ ...record });
        msg.permissions = msg.permissions.slice(-MAX_PER_MESSAGE);
      }
      ctx.emit({ type: 'permission', chatId, messageId: msg?.id, permission: { ...record } });
      const win = ctx.win;
      if (record.status === 'pending' && win && !win.isDestroyed() && !win.isFocused() && !bg.backgroundMode())
        win.flashFrame(true);
      if (record.status === 'always') ctx.store.save();
    },
  });
}

module.exports = { createPermissionBridge };
