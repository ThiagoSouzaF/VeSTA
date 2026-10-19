// The splash opens before the main window is shown, so Playwright's `firstWindow()` may be either of them.
// Scripts drive the main window, found by its URL.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function mainWindow(app, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const page = app.windows().find((w) => !w.isClosed() && w.url().includes('index.html'));
    if (page) return page;
    if (Date.now() > end) throw new Error('the main window did not open');
    await wait(50);
  }
}
module.exports = { mainWindow };
