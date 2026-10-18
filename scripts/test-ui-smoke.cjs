// UI smoke test: launches the real Electron app against a throwaway data dir and drives the renderer.
// Needs a fresh `npm run build` (the window loads dist/). Never sends a message to an AI.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');

const root = path.join(__dirname, '..');
const dataDir = scratch('ui-smoke');
const results = [];
const step = async (name, fn) => {
  await fn();
  results.push(name);
  console.log('ok -', name);
};

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, VESTA_DATA_DIR: dataDir, VESTA_NO_UPDATE: '1' },
  });
  const problems = [];
  try {
    const page = await app.firstWindow();
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    const heading = (text) => page.locator('h1, h2, h3', { hasText: text }).first();
    const nav = (name) => page.locator('nav .nav-item', { hasText: name });
    const draft = page.locator('textarea[aria-label="Mensagem"]');

    await step('window opens and the app finishes loading', async () => {
      await page.waitForSelector('.app-shell');
      await page.waitForSelector('.loading', { state: 'detached' });
      assert.equal(await page.title(), 'VeSTA');
      assert.equal(await page.locator('.welcome h1').count(), 1);
    });
    await step('userData points at the scratch dir', async () => {
      const boot = await page.evaluate(() => window.vesta.call('bootstrap'));
      assert.equal(path.resolve(boot.dataDir), path.resolve(dataDir));
    });
    await step('navigates Memória, Uso, Conexões and back to Conversas', async () => {
      await nav('Memória').click();
      await heading('Vale a pena lembrar.').waitFor();
      await nav('Uso').click();
      await heading('Seu uso, à vista.').waitFor();
      await nav('Conexões').click();
      await heading('Cada IA, do seu jeito.').waitFor();
      await nav('Conversas').click();
      await page.waitForSelector('.welcome h1');
    });
    await step('Preferências page opens', async () => {
      await page.locator('.sidebar-bottom .nav-item', { hasText: 'Preferências' }).click();
      await heading('Seu lar. Seu estilo.').waitFor();
      await nav('Conversas').click();
    });
    await step('creates a chat through the modal', async () => {
      await page.locator('.new-chat').click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: /Criar chat/ }).click();
      await page.waitForSelector('.chat-heading h2');
      assert.equal(await page.locator('.chat-heading h2').innerText(), 'Novo chat');
      assert.equal(await page.locator('.chat-list-item').count(), 1);
    });
    await step('keeps the draft when switching chats and back', async () => {
      await draft.fill('rascunho do chat A');
      await page.locator('.new-chat').click();
      await page.getByRole('button', { name: /Criar chat/ }).click();
      await page.waitForFunction(() => document.querySelectorAll('.chat-list-item').length === 2);
      assert.equal(await draft.inputValue(), '');
      await draft.fill('rascunho do chat B');
      const items = page.locator('.chat-list-item');
      // Newest chat is listed first: index 1 is chat A.
      await items.nth(1).click();
      assert.equal(await draft.inputValue(), 'rascunho do chat A');
      await items.nth(0).click();
      assert.equal(await draft.inputValue(), 'rascunho do chat B');
      await items.nth(1).click();
      assert.equal(await draft.inputValue(), 'rascunho do chat A');
    });
    await step('draft survives navigating to another page', async () => {
      await nav('Memória').click();
      await heading('Vale a pena lembrar.').waitFor();
      await nav('Conversas').click();
      assert.equal(await draft.inputValue(), 'rascunho do chat A');
    });
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(problems, [], 'renderer reported errors:\n' + problems.join('\n'));
    console.log('PASS ' + results.length + ' steps, no console errors');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
