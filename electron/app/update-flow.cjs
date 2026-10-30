// Updating the installed app: one request to GitHub Releases, a question before anything is downloaded, the verified
// installer, and the app quits so the installer can reopen it. Nothing happens without the person saying yes.
const updater = require('./updater.cjs');
const { redact } = require('../memory/redact.cjs');

const START_DELAY_MS = 4000;

function createUpdateFlow(ctx, { app, dialog }) {
  let updating = false;
  async function check() {
    const kind = updater.installKind(app);
    if (kind !== 'installed')
      return {
        status: 'unsupported',
        message:
          kind === 'portable'
            ? 'A versão portátil não se atualiza sozinha. Use o instalador.'
            : 'Atualização automática só funciona na versão instalada.',
      };
    if (updating) return { status: 'updating', message: 'A atualização já está em andamento.' };
    const info = await updater.check(app.getVersion());
    if (!info.available)
      return {
        status: info.reason ? 'error' : 'current',
        message: info.reason || 'Você já está na versão mais recente (' + app.getVersion() + ').',
      };
    const busy = ctx.jobs.size ? '\n\nHá respostas em andamento; elas serão interrompidas.' : '';
    const { response } = await dialog.showMessageBox(ctx.win, {
      type: 'info',
      title: 'Atualização disponível',
      message: 'VeSTA ' + info.version + ' está disponível',
      detail:
        'Você está na versão ' +
        app.getVersion() +
        '. Ao atualizar, o VeSTA fecha, instala a nova versão e abre de novo. Seus chats e memórias são mantidos.' +
        busy +
        (info.notes ? '\n\nNovidades:\n' + info.notes : ''),
      buttons: ['Atualizar agora', 'Agora não'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return { status: 'declined', message: 'Atualização adiada.' };
    updating = true;
    ctx.emit({ type: 'update', status: 'downloading', message: 'Baixando o VeSTA ' + info.version + '…' });
    ctx.win?.setProgressBar(2);
    try {
      const file = await updater.download(info);
      updater.launchInstaller(file);
      setTimeout(() => app.quit(), 300);
      return { status: 'installing', message: 'Instalando o VeSTA ' + info.version + '…' };
    } catch (e) {
      updating = false;
      ctx.win?.setProgressBar(-1);
      const message = 'Não foi possível atualizar: ' + redact(e.message).split('\n')[0];
      ctx.emit({ type: 'update', status: 'error', message });
      return { status: 'error', message };
    }
  }
  return {
    check,
    // At start, unless turned off in Preferências (or VESTA_NO_UPDATE=1): shortly after the window shows.
    schedule() {
      if (process.env.VESTA_NO_UPDATE === '1' || ctx.store?.state.settings.autoUpdate === false) return;
      setTimeout(() => check().catch(() => {}), START_DELAY_MS);
    },
  };
}

module.exports = { createUpdateFlow };
