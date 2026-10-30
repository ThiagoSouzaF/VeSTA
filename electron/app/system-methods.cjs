// Operations on the machine around the app: open the data folder, links and terminals, update check, window controls.
const { UserError } = require('./errors.cjs');
const { openTerminal } = require('../ai/terminal.cjs');
function systemMethods(ctx) {
  const { bounded } = ctx;
  return {
    openData: () => ctx.shell.openPath(ctx.app.getPath('userData')),
    openLink: ({ url }) => {
      const target = new URL(bounded(url, 3000));
      if (!['https:', 'http:'].includes(target.protocol)) throw new UserError('Link não suportado');
      return ctx.shell.openExternal(target.href);
    },
    openTerminal: (args) => openTerminal(ctx, args),
    checkUpdates: () => ctx.checkForUpdate(),
    window: ({ action }) => {
      if (action === 'minimize') ctx.win.minimize();
      if (action === 'maximize') ctx.win.isMaximized() ? ctx.win.unmaximize() : ctx.win.maximize();
      if (action === 'close') ctx.win.close();
    },
  };
}
module.exports = { systemMethods };
