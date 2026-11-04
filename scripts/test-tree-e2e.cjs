// E2E (Electron offscreen, no real AI): Conversas grouped by project in the sidebar.
//   1. folders for the Espaço pessoal and each project, with their chats; collapse one, collapse all, expand all
//   2. the "+" of a project opens the new-chat modal with that project chosen
//   3. dragging a chat onto another project moves it; its next turn runs in the new folder with the history in the
//      prompt (fake driver records what the CLI would receive)
// Needs a fresh `npm run build`. Usage: node scripts/test-tree-e2e.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');

const root = path.join(__dirname, '..');
const data = scratch('tree');
const dirA = path.join(data, 'api'),
  dirB = path.join(data, 'site');
fs.mkdirSync(dirA, { recursive: true });
fs.mkdirSync(dirB, { recursive: true });
const now = Date.now();
const chat = (id, title, projectId, messages = []) => ({
  id,
  title,
  provider: 'claude',
  model: '',
  projectId,
  mode: 'edit',
  messages,
  sessionId: 'sessao-' + id,
  createdAt: now,
  updatedAt: now,
  memory: false,
});
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 4,
    settings: { memoryEnabled: false, capture: false, memoryTools: false },
    projects: [
      { id: 'pa', name: 'api', path: dirA, createdAt: now },
      { id: 'pb', name: 'site', path: dirB, createdAt: now },
    ],
    chats: [
      chat('c1', 'Corrigir login', 'pa', [
        { id: 'u1', role: 'user', text: 'O login quebra com senha vazia', createdAt: now },
        { id: 'a1', role: 'assistant', text: 'Corrigi em auth.js', status: 'done', createdAt: now },
      ]),
      chat('c2', 'Ideias soltas', null),
      chat('c3', 'Landing page', 'pb'),
    ],
    memories: [],
  })
);

let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log('ok - ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL - ' + name + ': ' + e.message.replace(/\s+/g, ' ').slice(0, 500));
  }
};

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, VESTA_DATA_DIR: data, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1' },
  });
  try {
    const page = await mainWindow(app);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('.loading', { state: 'detached' });
    await page.evaluate(() => localStorage.removeItem('vesta.sidebar.collapsed'));
    // No real AI: the driver records the cwd and the prompt it would have received.
    await app.evaluate(
      (_, electronDir) => {
        const req = (f) => process.mainModule.require(electronDir + '/' + f);
        const main = req('main.cjs'),
          drivers = req('ai/drivers.cjs');
        main.ctx.integrations.claude = { installed: true, exe: 'fake-claude.exe' };
        globalThis.__turns = [];
        drivers.start = (provider, spec, ctx) => {
          globalThis.__turns.push({ cwd: ctx.cwd, prompt: ctx.prompt, args: spec.args });
          ctx.parse.accept({ type: 'assistant', message: { content: [{ type: 'text', text: 'Ok.' }] } });
          ctx.parse.accept({ type: 'result', result: 'Ok.', num_turns: 1 });
          return { done: Promise.resolve({ code: 0, stderr: '' }), stop() {} };
        };
      },
      path.join(root, 'electron').split(String.fromCharCode(92)).join('/')
    );
    const group = (key) => page.locator('.chat-group[data-group="' + key + '"]');
    const itemsOf = (key) => group(key).locator('.chat-list-item');

    await step('a folder per project (and the Espaço pessoal), each with its own chats', async () => {
      assert.deepEqual(await page.locator('.chat-group').evaluateAll((els) => els.map((e) => e.dataset.group)), [
        'personal',
        'pa',
        'pb',
      ]);
      assert.deepEqual(await itemsOf('personal').locator('div > span').allInnerTexts(), ['Ideias soltas']);
      assert.equal(await itemsOf('pa').count(), 1);
      assert.equal(await itemsOf('pb').count(), 1);
    });

    await step('collapse one folder, then collapse and expand everything', async () => {
      await group('pa').locator('.chat-group-toggle').click();
      assert.equal(await itemsOf('pa').count(), 0);
      assert.equal(await itemsOf('pb').count(), 1);
      await page.getByRole('button', { name: 'Recolher tudo' }).click();
      assert.equal(await page.locator('.chat-list-item').count(), 0);
      await page.getByRole('button', { name: 'Expandir tudo' }).click();
      assert.equal(await page.locator('.chat-list-item').count(), 3);
      // Searching opens the folders with a match and hides the others.
      await page.locator('#search-chats').fill('landing');
      assert.deepEqual(await page.locator('.chat-group').evaluateAll((els) => els.map((e) => e.dataset.group)), ['pb']);
      await page.locator('#search-chats').fill('');
    });

    await step('the "+" of a folder starts a chat in that project', async () => {
      await group('pb').hover();
      await page.getByRole('button', { name: 'Nova conversa em site' }).click();
      await page.getByRole('dialog').waitFor();
      assert.equal(await page.getByRole('dialog').locator('select').first().inputValue(), 'pb');
      await page.getByRole('button', { name: /Criar chat/ }).click();
      await page.waitForFunction(
        () => document.querySelectorAll('.chat-group[data-group="pb"] .chat-list-item').length === 2
      );
    });

    await step('dragging a chat onto another project moves it with its context', async () => {
      await itemsOf('pa').first().dragTo(group('pb').locator('.chat-group-head'));
      await page.waitForFunction(
        () => document.querySelectorAll('.chat-group[data-group="pa"] .chat-list-item').length === 0
      );
      assert.equal(await itemsOf('pb').filter({ hasText: 'Corrigir login' }).count(), 1);
      const moved = (await page.evaluate(() => window.vesta.call('bootstrap'))).state.chats.find((c) => c.id === 'c1');
      assert.equal(moved.projectId, 'pb');
      assert.equal(moved.sessionId, null, 'the native session stayed in the old folder');
      assert.equal(moved.handoffReason, 'project');
      await page.locator('.toast, [role=status]').filter({ hasText: 'Conversa movida para site' }).first().waitFor();
      // Next message: runs in the new folder, with the conversation so far in the prompt.
      await itemsOf('pb').filter({ hasText: 'Corrigir login' }).click();
      await page.locator('textarea[aria-label="Mensagem"]').fill('E agora no site?');
      await page.keyboard.press('Enter');
      // The fake driver runs in the main process: poll it until the turn is recorded.
      let turns = [];
      for (let i = 0; i < 100 && !turns.length; i++) {
        turns = await app.evaluate(() => globalThis.__turns);
        if (!turns.length) await new Promise((r) => setTimeout(r, 100));
      }
      const last = turns.at(-1);
      assert.equal(path.resolve(last.cwd), path.resolve(dirB));
      assert.match(last.prompt, /movida para outro projeto/);
      assert.match(last.prompt, /O login quebra com senha vazia/);
      assert.ok(!last.args.includes('sessao-c1'), 'the old session id is not resumed');
      const after = (await page.evaluate(() => window.vesta.call('bootstrap'))).state.chats.find((c) => c.id === 'c1');
      assert.equal(after.handoffPending, false, 'the history goes only once');
    });

    await step('dropping a chat back on its own folder does nothing', async () => {
      const before = await app.evaluate(() => globalThis.__turns.length);
      await itemsOf('pb').filter({ hasText: 'Landing page' }).dragTo(group('pb').locator('.chat-group-head'));
      const c3 = (await page.evaluate(() => window.vesta.call('bootstrap'))).state.chats.find((c) => c.id === 'c3');
      assert.equal(c3.sessionId, 'sessao-c3');
      assert.equal(await app.evaluate(() => globalThis.__turns.length), before);
    });
  } finally {
    await app.close().catch(() => {});
  }
  console.log(
    failed
      ? 'FAIL: ' + failed + ' passo(s)'
      : 'PASS: conversas por projeto, recolher, nova conversa no projeto e arrastar'
  );
  process.exitCode = failed ? 1 : 0;
})();
