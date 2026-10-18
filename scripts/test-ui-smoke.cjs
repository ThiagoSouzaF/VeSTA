// UI smoke test: launches the real Electron app against throwaway data dirs and drives the renderer.
// Needs a fresh `npm run build` (the window loads dist/). Never sends a message to an AI and never reads Codex.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { seedStore } = require('./seed-store.cjs');

const root = path.join(__dirname, '..');
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    e.message = 'step "' + name + '": ' + e.message;
    throw e;
  }
  results.push(name);
  console.log('ok -', name);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const launch = (dataDir) =>
  electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, VESTA_DATA_DIR: dataDir, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1' },
  });
// ---- Phase 1: an empty store ------------------------------------------------------------------------------------
async function emptyStorePhase() {
  const dataDir = scratch('ui-smoke');
  const app = await launch(dataDir);
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
      assert.equal(boot.state.settings.fontScale, 1);
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
    await step('Uso with no data shows one section per AI without errors', async () => {
      await nav('Uso').click();
      await heading('Seu uso, à vista.').waitFor();
      assert.equal(await page.locator('.usage-provider').count(), 4);
      assert.equal(await page.locator('.usage-bar-card').count(), 0);
    });
    await wait(500);
    assert.deepEqual(problems, [], 'renderer reported errors:\n' + problems.join('\n'));
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ---- Phase 2: long conversation, scroll button, zoom, usage ---------------------------------------------------
async function seededPhase() {
  const dataDir = scratch('ui-smoke-seed');
  seedStore(dataDir);
  let app = await launch(dataDir);
  const problems = [];
  try {
    let page = await app.firstWindow();
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    const nav = (name) => page.locator('nav .nav-item', { hasText: name });
    const inject = (ev) =>
      app.evaluate(({ BrowserWindow }, e) => BrowserWindow.getAllWindows()[0].webContents.send('vesta:event', e), ev);
    const metrics = () =>
      page.evaluate(() => {
        const el = document.querySelector('.messages');
        return {
          top: el.scrollTop,
          max: el.scrollHeight - el.clientHeight,
          scrollable: el.scrollHeight > el.clientHeight,
          button: !!document.querySelector('.scroll-end'),
          badge: document.querySelector('.scroll-end-badge')?.textContent || '',
        };
      });
    const atEnd = async () => (await metrics()).max - (await metrics()).top <= 4;
    const openChat = async (title) => {
      await nav('Conversas').click();
      await page.locator('.chat-list-item', { hasText: title }).click();
      await page.waitForSelector('.messages .message');
    };
    const scale = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--font-scale'));
    const bodyPx = () =>
      page.evaluate(() =>
        parseFloat(getComputedStyle(document.querySelector('.message.assistant .markdown p')).fontSize)
      );
    await page.waitForSelector('.loading', { state: 'detached' });

    await step('opening a long chat lands at the end, without the go-to-end button', async () => {
      await openChat('Conversa longa');
      await page.waitForFunction(() => {
        const el = document.querySelector('.messages');
        return el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
      });
      const m = await metrics();
      assert.ok(m.scrollable, 'the seeded conversation must overflow');
      assert.equal(m.button, false);
    });
    await step('scrolling up shows the button and streamed text does not pull the view down', async () => {
      await page.evaluate(() => (document.querySelector('.messages').scrollTop = 200));
      await page.waitForSelector('.scroll-end');
      await inject({
        type: 'text',
        chatId: 'chat-long',
        messageId: 'a39',
        text: '\n\nTEXTO-NOVO-1 ' + 'palavra '.repeat(200),
      });
      await page.waitForFunction(() => document.body.innerText.includes('TEXTO-NOVO-1'));
      const m = await metrics();
      assert.ok(Math.abs(m.top - 200) <= 2, 'scroll moved from 200 to ' + m.top);
      assert.equal(m.button, true);
    });
    await step('new activity while scrolled up counts on the button', async () => {
      await inject({
        type: 'activity',
        chatId: 'chat-long',
        messageId: 'a39',
        activity: { id: 'act1', label: 'Executando comando', detail: 'ls', kind: 'command', status: 'running' },
      });
      await page.waitForFunction(() => document.querySelector('.scroll-end-badge')?.textContent === '1');
      await inject({
        type: 'activity',
        chatId: 'chat-long',
        messageId: 'a39',
        activity: { id: 'act2', label: 'Lendo arquivo', detail: 'x', kind: 'file', status: 'running' },
      });
      await page.waitForFunction(() => document.querySelector('.scroll-end-badge')?.textContent === '2');
    });
    await step('clicking the button scrolls smoothly to the end and hides it', async () => {
      await page.locator('.scroll-end').click();
      await page.waitForFunction(() => {
        const el = document.querySelector('.messages');
        return el.scrollHeight - el.scrollTop - el.clientHeight <= 4 && !document.querySelector('.scroll-end');
      });
    });
    await step('at the end, streamed text keeps following', async () => {
      await inject({
        type: 'text',
        chatId: 'chat-long',
        messageId: 'a39',
        text: '\n\nTEXTO-NOVO-2 ' + 'palavra '.repeat(400),
      });
      await page.waitForFunction(() => document.body.innerText.includes('TEXTO-NOVO-2'));
      await page.waitForFunction(() => {
        const el = document.querySelector('.messages');
        return el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
      });
      assert.equal((await metrics()).button, false);
    });
    await step('End key jumps to the end', async () => {
      await page.evaluate(() => {
        document.activeElement?.blur();
        document.querySelector('.messages').scrollTop = 0;
      });
      await page.waitForSelector('.scroll-end');
      await page.keyboard.press('End');
      await page.waitForFunction(() => {
        const el = document.querySelector('.messages');
        return el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
      });
    });
    await step('switching chats goes to the end of the other chat', async () => {
      await openChat('Conversa curta');
      assert.equal(await page.locator('.messages .message').count(), 2);
      await openChat('Conversa longa');
      await page.waitForFunction(() => {
        const el = document.querySelector('.messages');
        return el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
      });
    });
    await step('Ctrl+= / Ctrl+- / Ctrl+0 change --font-scale and the rendered text size', async () => {
      assert.equal(await scale(), '1');
      const base = await bodyPx();
      await page.keyboard.press('Control+=');
      assert.equal(await scale(), '1.1');
      assert.ok((await bodyPx()) > base, 'text should grow');
      await page.keyboard.press('Control+-');
      await page.keyboard.press('Control+-');
      assert.equal(await scale(), '0.9');
      assert.ok((await bodyPx()) < base, 'text should shrink');
      await page.keyboard.press('Control+0');
      assert.equal(await scale(), '1');
      assert.equal(await bodyPx(), base);
    });
    await step('Ctrl+wheel zooms and Chromium native zoom stays at 100%', async () => {
      await page.mouse.move(500, 400);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -120);
      await page.keyboard.up('Control');
      await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--font-scale') === '1.1');
      const native = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
      );
      assert.equal(native, 1);
      await page.keyboard.press('Control+=');
      assert.equal(await scale(), '1.2');
    });
    await step('Preferências shows the percentage and its buttons step the zoom', async () => {
      await page.locator('.sidebar-bottom .nav-item', { hasText: 'Preferências' }).click();
      await page.locator('.zoom-value').waitFor();
      assert.equal(await page.locator('.zoom-value').innerText(), '120%');
      await page.getByRole('button', { name: 'Aumentar texto' }).click();
      assert.equal(await page.locator('.zoom-value').innerText(), '130%');
      await page.getByRole('button', { name: 'Diminuir texto' }).click();
      assert.equal(await page.locator('.zoom-value').innerText(), '120%');
    });
    await wait(600);
    await step('zoom persists after restarting the app', async () => {
      await app.close();
      app = await launch(dataDir);
      page = await app.firstWindow();
      page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
      page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
      await page.waitForSelector('.loading', { state: 'detached' });
      await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--font-scale') === '1.2');
      const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'vesta.json'), 'utf8'));
      assert.equal(saved.settings.fontScale, 1.2);
    });
    await step('Uso renders one section per AI with the seeded windows, tokens and costs', async () => {
      await page.locator('nav .nav-item', { hasText: 'Uso' }).click();
      await page.locator('.usage-provider').first().waitFor();
      assert.deepEqual(await page.locator('.usage-provider').evaluateAll((els) => els.map((e) => e.dataset.provider)), [
        'codex',
        'claude',
        'drael',
        'opencode',
      ]);
      const sec = (id) => page.locator('.usage-provider[data-provider="' + id + '"]');
      const codex = sec('codex');
      assert.equal(await codex.locator('.usage-bar-card').count(), 2);
      const codexText = await codex.innerText();
      assert.match(codexText, /42%/);
      assert.match(codexText, /7%/);
      assert.match(codexText, /Plano plus/i);
      assert.match(codexText, /reseta em/);
      assert.match(codexText, /3[.,]0k entrada/, 'tokens de hoje');
      assert.match(codexText, /sem custo/);
      const claude = sec('claude');
      assert.equal(await claude.locator('.usage-bar-card.hot').count(), 1, '91% is hot');
      assert.match(await claude.innerText(), /\$0\.750/);
      assert.match(await claude.innerText(), /\$2\.00/, '7 dias soma 0.75 + 1.25');
      assert.equal(await sec('drael').locator('.usage-bar-card').count(), 0);
      assert.match(await sec('drael').innerText(), /não informa janelas/);
      assert.match(await sec('opencode').innerText(), /500 entrada/);
    });
    await wait(500);
    assert.deepEqual(problems, [], 'renderer reported errors:\n' + problems.join('\n'));
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

(async () => {
  await emptyStorePhase();
  await seededPhase();
  console.log('PASS ' + results.length + ' steps, no console errors');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
