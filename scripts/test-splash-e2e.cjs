// Splash e2e: launches the real app against throwaway data dirs and watches the opening window through Playwright.
//  1. real progress: stages complete in order, percentages only go up, the label follows the stage, 100% says PRONTO;
//  2. the main window appears only when ready, the splash then closes, and the first window is the main one;
//  3. VESTA_SERVICE_TEST=1 opens no splash;
//  4. a boot failure (unreadable store) keeps the splash up with a readable message, and FECHAR quits.
// Needs a fresh `npm run build` (the windows load dist/). Never talks to an AI.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');

const root = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    e.message = 'step "' + name + '": ' + e.message;
    throw e;
  }
  console.log('ok -', name);
};
// Starts the app through Playwright; `pages()` lists the windows still open, `find` waits for one by URL.
async function start(dataDir, env = {}) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, VESTA_DATA_DIR: dataDir, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1', ...env },
  });
  const child = app.process();
  const exited = new Promise((r) => child.once('exit', r));
  const pages = () => app.windows().filter((p) => !p.isClosed());
  const find = async (part, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const p = pages().find((x) => x.url().includes(part));
      if (p) return p;
      await wait(50);
    }
    throw new Error('window "' + part + '" did not appear');
  };
  const stop = async () => {
    await Promise.race([app.close().catch(() => {}), wait(8000)]);
    child.kill();
  };
  return { child, exited, app, pages, find, stop };
}
const mainVisible = (electronApp) =>
  electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('index.html') && w.isVisible())
  );
// Windows that really exist in the main process (Playwright keeps closed windows in its list for a while).
const openUrls = (electronApp) =>
  electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));
const splashGone = async (app, tries = 120) => {
  for (let i = 0; i < tries; i++) {
    if (!(await openUrls(app.app)).some((u) => u.includes('splash.html'))) return true;
    await wait(40);
  }
  return false;
};
const read = (page) =>
  page.evaluate(() => ({
    label: document.getElementById('label').textContent,
    percent: Number(document.getElementById('percent').textContent.replace('%', '')),
    state: document.body.dataset.state,
    done: [...document.querySelectorAll('#steps li')]
      .filter((li) => li.dataset.done === 'true')
      .map((li) => li.dataset.step),
  }));

(async () => {
  await step('progress follows the real stages and the main window opens only when ready', async () => {
    const dir = scratch('splash-ok');
    const app = await start(dir, { VESTA_BOOT_STEP_DELAY_MS: '500' });
    try {
      const splash = await app.find('splash.html');
      await splash.waitForSelector('#label');
      const seen = [];
      const startedAt = Date.now();
      let mainVisibleEarly = false;
      while (Date.now() - startedAt < 20000) {
        const s = await read(splash).catch(() => null);
        if (!s) break; // the splash closed
        if (!seen.length || seen.at(-1).percent !== s.percent) seen.push(s);
        // The main window is only shown once the boot is complete.
        if (s.state !== 'ready' && (await mainVisible(app.app))) mainVisibleEarly = true;
        if (s.state === 'ready') break;
        await wait(40);
      }
      assert.ok(
        seen.length >= 3,
        'saw several distinct progress values: ' + JSON.stringify(seen.map((s) => s.percent))
      );
      const percents = seen.map((s) => s.percent);
      assert.deepEqual(
        percents,
        [...percents].sort((a, b) => a - b),
        'progress never goes back'
      );
      assert.ok(
        seen.some((s) => s.label === 'INICIANDO MEMÓRIA'),
        'memory stage shown: ' + JSON.stringify(seen.map((s) => s.label))
      );
      assert.ok(
        seen.some((s) => s.label === 'PROCURANDO IAS'),
        'integrations stage shown'
      );
      assert.equal(seen.at(-1).percent, 100);
      assert.equal(seen.at(-1).label, 'PRONTO');
      assert.equal(mainVisibleEarly, false, 'the main window stayed hidden until the boot finished');
      // the splash fades and closes; the main window is the one left
      const main = await app.find('index.html');
      await main.waitForSelector('.app-shell');
      assert.equal(await splashGone(app), true, 'splash closed');
      assert.equal(app.pages()[0].url().includes('index.html'), true, 'the first window is the main window');
      await main.waitForSelector('.loading', { state: 'detached' });
    } finally {
      await app.stop();
    }
  });

  await step('the splash stays up at least 1.2 s even when the boot is instant', async () => {
    const dir = scratch('splash-min');
    const app = await start(dir);
    try {
      const splash = await app.find('splash.html');
      const t0 = Date.now();
      await splash.waitForSelector('#label');
      const main = await app.find('index.html');
      await main.waitForSelector('.app-shell');
      assert.equal(await splashGone(app), true, 'splash closed');
      assert.ok(Date.now() - t0 >= 1100, 'splash was visible for ' + (Date.now() - t0) + ' ms');
    } finally {
      await app.stop();
    }
  });

  await step('VESTA_SERVICE_TEST=1 opens no splash', async () => {
    const dir = scratch('splash-test');
    const app = await start(dir, { VESTA_SERVICE_TEST: '1' });
    try {
      const main = await app.find('index.html');
      await main.waitForSelector('.app-shell');
      await wait(500);
      assert.equal((await openUrls(app.app)).filter((u) => u.includes('splash.html')).length, 0);
    } finally {
      await app.stop();
    }
  });

  await step('a boot failure keeps the splash with a readable message; FECHAR quits', async () => {
    const dir = scratch('splash-bad');
    fs.writeFileSync(path.join(dir, 'vesta.json'), '{ not json');
    const app = await start(dir);
    try {
      const splash = await app.find('splash.html');
      await splash.waitForSelector('#fail:not([hidden])');
      const text = await splash.locator('#message').innerText();
      assert.match(text, /dados do VeSTA não puderam ser lidos/);
      assert.equal(await splash.evaluate(() => document.body.dataset.state), 'error');
      assert.equal(await splash.locator('#proceed').isHidden(), true, 'a store failure cannot be skipped');
      assert.equal(app.pages().filter((p) => p.url().includes('index.html')).length <= 1, true);
      await splash.locator('#quit').click();
      await Promise.race([app.exited, wait(8000)]);
      assert.equal(app.child.exitCode !== null || app.child.signalCode !== null, true, 'the app quit');
    } finally {
      await app.stop();
    }
  });
  console.log('PASS splash e2e');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
