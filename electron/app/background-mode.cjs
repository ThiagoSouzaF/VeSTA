// Test runs open their windows off-screen, without taking focus or a taskbar slot, so they never get in the way of
// whoever is using the computer. On by default whenever a test points VeSTA at a throwaway data dir
// (VESTA_DATA_DIR); VESTA_TEST_BACKGROUND=0 shows the windows again, =1 forces it. Never in the packaged app.
const { app } = require('electron');

function backgroundMode(env = process.env, packaged = app.isPackaged) {
  if (packaged) return false;
  if (env.VESTA_TEST_BACKGROUND === '1') return true;
  if (env.VESTA_TEST_BACKGROUND === '0') return false;
  return Boolean(env.VESTA_DATA_DIR);
}

// Off-screen and out of the taskbar. Rendering must not pause even though Windows sees the window as hidden, or
// screenshots and timers in the tests would stall.
const OFFSCREEN = -32000;
const backgroundWindowOptions = () => (backgroundMode() ? { x: OFFSCREEN, y: OFFSCREEN, skipTaskbar: true } : {});
const backgroundWebPreferences = () => (backgroundMode() ? { backgroundThrottling: false } : {});

function configureBackgroundMode() {
  if (backgroundMode()) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// show() brings the window to the front and takes focus; in background mode it appears without either.
function reveal(win) {
  if (!backgroundMode()) return win.show();
  // `center: true` (the splash) wins over x/y at creation, so the window is moved again right before it shows.
  win.setPosition(OFFSCREEN, OFFSCREEN);
  win.showInactive();
}

module.exports = { backgroundMode, backgroundWindowOptions, backgroundWebPreferences, configureBackgroundMode, reveal };
