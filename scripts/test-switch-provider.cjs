// Runs in an isolated profile; uses Drael and OpenCode for three small replies.
const { _electron: electron } = require('playwright');
const { mainWindow } = require('./test-windows.cjs');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const data = require('./test-scratch.cjs')('switch-ui');
  const env = { ...process.env, VESTA_DATA_DIR: data, VESTA_SERVICE_TEST: '1', VESTA_NO_UPDATE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await mainWindow(app);
    await page.waitForSelector('.new-chat');
    await page.evaluate(() => window.vesta.call('saveSettings', { memoryEnabled: false, capture: false }));
    await page
      .getByRole('button', { name: /Novo chat/ })
      .first()
      .click();
    await page
      .locator('.modal-providers button')
      .filter({ hasText: 'Drael' })
      .filter({ hasNotText: 'OpenCode' })
      .click();
    await page.getByRole('button', { name: 'Criar chat' }).click();
    const id = await page.evaluate(async () => {
      const b = await window.vesta.call('bootstrap');
      return b.state.chats[0].id;
    });
    async function turn(text, checkBusy = false) {
      await page.evaluate(({ id, text }) => window.vesta.call('send', { chatId: id, text }), { id, text });
      if (checkBusy) {
        const error = await page.evaluate(async (id) => {
          try {
            await window.vesta.call('switchProvider', { id, provider: 'opencode' });
            return '';
          } catch (e) {
            return e.message;
          }
        }, id);
        assert.match(error, /Aguarde/);
      }
      let result;
      const end = Date.now() + 120000;
      while (Date.now() < end) {
        result = await page.evaluate(() => window.vesta.call('bootstrap'));
        if (!result.state.running.length) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const c = result.state.chats.find((c) => c.id === id),
        answer = c.messages.at(-1);
      assert.equal(answer.status, 'done', answer.error);
      return { chat: c, text: answer.text };
    }
    await turn('O marcador desta conversa é jabuticaba7429. Responda apenas OK, sem ferramentas.', true);
    await page.getByRole('button', { name: 'Trocar IA desta conversa' }).click();
    await page.locator('.model-menu button').filter({ hasText: 'Drael (OpenCode)' }).click();
    await page.waitForFunction(() =>
      document.querySelector('.composer-options')?.textContent.includes('Drael (OpenCode)')
    );
    const second = await turn(
      'Qual foi o marcador informado antes da troca de IA? Responda apenas o marcador, sem ferramentas.'
    );
    assert.match(second.text, /jabuticaba7429/);
    assert.ok(second.chat.sessionId);
    assert.equal(second.chat.messages[1].provider, 'drael');
    assert.equal(second.chat.messages[3].provider, 'opencode');
    await page.getByRole('button', { name: 'Trocar IA desta conversa' }).click();
    await page
      .locator('.model-menu button')
      .filter({ hasText: /^Drael$/ })
      .click();
    const third = await turn('Qual foi o marcador informado no começo? Responda apenas o marcador, sem ferramentas.');
    assert.match(third.text, /jabuticaba7429/);
    assert.equal(third.chat.sessionId, null);
    const authors = await page.locator('.message-author strong').allTextContents();
    assert.ok(authors.includes('Drael'));
    assert.ok(authors.includes('Drael (OpenCode)'));
    await page.getByRole('button', { name: 'Trocar IA desta conversa' }).click();
    await page.screenshot({ path: path.join(data, 'switch.png') });
    console.log(
      'PASS: UI switch, blocked during generation, cross-provider history in both directions, sessions isolated, correct response authors. Screenshot: ' +
        path.join(data, 'switch.png')
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
