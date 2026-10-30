// Every renderer-callable operation. The IPC handler dispatches into this object; the phone reaches the subset in
// remote/allowlist.cjs. Each domain lives in its own *-methods module.
const { discover } = require('../ai/integrations.cjs');
const { questMethods } = require('../quests/methods.cjs');
const { attachmentMethods } = require('../attachments/methods.cjs');
const { backupMethods } = require('../backup/methods.cjs');
const { chatMethods } = require('../chat/chat-methods.cjs');
const { memoryMethods } = require('../memory/memory-methods.cjs');
const { projectMethods } = require('./project-methods.cjs');
const { settingsMethods, clampFontScale } = require('./settings-methods.cjs');
const { systemMethods } = require('./system-methods.cjs');
function createMethods(ctx) {
  return {
    // The first call after the opening reuses the integrations probed while the splash was up.
    bootstrap: async () => {
      const probing = ctx.bootDiscovery;
      ctx.bootDiscovery = null;
      return {
        state: ctx.state(),
        integrations: await (probing || discover(ctx)),
        dataDir: ctx.app.getPath('userData'),
      };
    },
    refreshConnections: () => discover(ctx),
    ...chatMethods(ctx),
    ...questMethods(ctx),
    ...attachmentMethods(ctx),
    ...backupMethods(ctx),
    ...projectMethods(ctx),
    ...settingsMethods(ctx),
    ...memoryMethods(ctx),
    ...systemMethods(ctx),
  };
}
module.exports = { createMethods, clampFontScale };
