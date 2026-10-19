// Isolated desktop smoke test; uses the configured Drael account for two replies.
const { _electron: electron } = require('playwright');
const { mainWindow } = require('./test-windows.cjs');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-drael-ui-'));
  const env = { ...process.env, VESTA_DATA_DIR: data, VESTA_SERVICE_TEST: '1', VESTA_NO_UPDATE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await mainWindow(app);
    await page.waitForSelector('.new-chat');
    await page
      .getByRole('button', { name: /Novo chat/ })
      .first()
      .click();
    await page
      .locator('.modal-providers button')
      .filter({ hasText: 'Drael' })
      .filter({ hasNotText: 'OpenCode' })
      .click();
    assert.ok(await page.locator('.mode-options button').filter({ hasText: 'Pedir permissão' }).isDisabled());
    await page.screenshot({ path: path.join(data, 'native-ui.png') });
    console.log('Screenshot: ' + path.join(data, 'native-ui.png'));
    await page.getByRole('button', { name: 'Criar chat' }).click();
    const id = await page.evaluate(async () => {
      const b = await window.vesta.call('bootstrap');
      return b.state.chats[0].id;
    });
    async function turn(text) {
      await page.evaluate(({ id, text }) => window.vesta.call('send', { chatId: id, text }), { id, text });
      let result;
      const end = Date.now() + 90000;
      while (Date.now() < end) {
        result = await page.evaluate(() => window.vesta.call('bootstrap'));
        if (!result.state.running.length) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      const answer = result.state.chats.find((c) => c.id === id).messages.at(-1);
      assert.equal(answer.status, 'done', answer.error);
      assert.ok(answer.memorySaved);
      return answer.text;
    }
    await turn('O marcador desta conversa é turquesa7429. Responda apenas OK, sem ferramentas.');
    assert.match(
      await turn('Qual foi o marcador que informei na mensagem anterior? Responda apenas o marcador, sem ferramentas.'),
      /turquesa7429/
    );
    console.log('PASS: native UI, authentication, automatic capture, two-turn history.');
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
