// Streaming benchmark: injects text deltas into the real renderer (webContents.send, the same IPC path as the AI
// events) and measures how long the UI takes to show them and how much main-thread time it burns.
//   node scripts/bench-streaming.cjs [appRoot] [deltas=2000] [ratePerSecond=1000|burst] [runs=3]
// appRoot defaults to this repo (needs `npm run build`); point it at another checkout to compare versions.
// Never reads an AI or the real data dir.
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { seedStore } = require('./seed-store.cjs');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const deltas = Number(process.argv[3] || 2000);
const rate = process.argv[4] === 'burst' ? Infinity : Number(process.argv[4] || 1000);
const runs = Number(process.argv[5] || 3);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function once() {
  const dataDir = scratch('bench');
  seedStore(dataDir, { turns: 40 });
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, VESTA_DATA_DIR: dataDir, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.loading', { state: 'detached' });
    await page.locator('.chat-list-item', { hasText: 'Conversa longa' }).click();
    await page.waitForSelector('.messages .message');
    await new Promise((r) => setTimeout(r, 1000));
    await page.evaluate(() => {
      const lastMarkdown = () =>
        [...document.querySelectorAll('.messages .message')].at(-1)?.querySelector('.markdown');
      const b = (window.__bench = { longMs: 0, longCount: 0, maxLongMs: 0, frames: 0, maxGapMs: 0, mutations: 0 });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          b.longMs += e.duration;
          b.longCount++;
          b.maxLongMs = Math.max(b.maxLongMs, e.duration);
        }
      }).observe({ entryTypes: ['longtask'] });
      new MutationObserver((r) => (b.mutations += r.length)).observe(document.querySelector('.messages'), {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      let last = performance.now();
      const tick = (t) => {
        b.frames++;
        b.maxGapMs = Math.max(b.maxGapMs, t - last);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__done = new Promise((resolve) => {
        const iv = setInterval(() => {
          const el = lastMarkdown();
          if (el && el.textContent.includes('FIM-DO-STREAM')) {
            clearInterval(iv);
            resolve(Date.now());
          }
        }, 2);
      });
    });
    const t0 = Date.now();
    // Sends from the main process, paced to `rate` deltas per second (or all at once).
    await app.evaluate(
      ({ BrowserWindow }, { n, rate }) =>
        new Promise((resolve) => {
          const win = BrowserWindow.getAllWindows()[0];
          const start = Date.now();
          let sent = 0;
          const pump = () => {
            const due = rate === null ? n : Math.min(n, Math.floor(((Date.now() - start) / 1000) * rate) + 1);
            while (sent < due) {
              sent++;
              win.webContents.send('vesta:event', {
                type: 'text',
                chatId: 'chat-long',
                messageId: 'a39',
                text:
                  sent === n
                    ? ' FIM-DO-STREAM'
                    : (sent % 40 === 0 ? '\n\n' : ' ') + 'palavra' + sent + ' **negrito** `código`',
              });
            }
            sent >= n ? resolve() : setImmediate(pump);
          };
          pump();
        }),
      { n: deltas, rate: Number.isFinite(rate) ? rate : null }
    );
    const sentMs = Date.now() - t0;
    const finished = await page.evaluate(() => window.__done);
    const b = await page.evaluate(() => window.__bench);
    const length = await page.evaluate(
      () => [...document.querySelectorAll('.messages .message')].at(-1).querySelector('.markdown').textContent.length
    );
    return { sendMs: sentMs, uiDoneMs: finished - t0, ...b, longMs: Math.round(b.longMs), textLength: length };
  } finally {
    await app.close().catch(() => {});
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  }
}
(async () => {
  const all = [];
  for (let i = 0; i < runs; i++) all.push(await once());
  const keys = ['uiDoneMs', 'longMs', 'longCount', 'maxLongMs', 'frames', 'maxGapMs', 'mutations'];
  const med = Object.fromEntries(keys.map((k) => [k, Math.round(median(all.map((r) => r[k])))]));
  console.log(
    JSON.stringify(
      { root, deltas, rate: Number.isFinite(rate) ? rate + '/s' : 'burst', runs, median: med, all },
      null,
      1
    )
  );
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAIL', e.message);
    process.exit(1);
  });
