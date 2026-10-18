// Native confirmation dialogs on the desktop for things a paired phone asks for (new device, full-access mode).
// Resolves 'yes' | 'no' | 'timeout'. Nothing is granted on error, close, Escape or silence.
const TIMEOUT_MS = 2 * 60 * 1000;
const MAX_QUEUE = 3;

// VESTA_TEST_AUTO_CONFIRM answers the dialogs without UI, for automated tests only: '1' accepts, 'deny' refuses.
// It is ignored by the packaged app, so it cannot weaken an installed VeSTA.
function autoAnswer({ env = process.env, isPackaged = false } = {}) {
  if (isPackaged) return null;
  const v = env.VESTA_TEST_AUTO_CONFIRM;
  return v === '1' ? 'yes' : v === 'deny' ? 'no' : null;
}

function createConfirmer({
  dialog,
  getWindow = () => null,
  isPackaged = false,
  env = process.env,
  timeoutMs = TIMEOUT_MS,
  maxQueue = MAX_QUEUE,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let chain = Promise.resolve(),
    waiting = 0;
  async function ask({ title = 'VeSTA — controle remoto', message, detail = '', okLabel = 'Autorizar' }) {
    const win = getWindow();
    const ac = new AbortController();
    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimer(() => (ac.abort(), resolve('timeout')), timeoutMs);
    });
    try {
      win?.flashFrame?.(true);
      const options = {
        type: 'warning',
        title,
        message,
        detail,
        buttons: [okLabel, 'Recusar'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        signal: ac.signal,
      };
      const shown = (win && !win.isDestroyed?.() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
        .then((r) => (r?.response === 0 ? 'yes' : 'no'))
        .catch(() => 'no');
      return await Promise.race([shown, timedOut]);
    } finally {
      clearTimer(timer);
    }
  }
  return {
    confirm(request) {
      const auto = autoAnswer({ env, isPackaged });
      if (auto) return Promise.resolve(auto);
      if (waiting >= maxQueue) return Promise.resolve('busy');
      waiting++;
      const run = chain.then(() => ask(request));
      chain = run.then(
        () => {},
        () => {}
      );
      return run.finally(() => waiting--);
    },
  };
}
module.exports = { createConfirmer, autoAnswer, TIMEOUT_MS };
