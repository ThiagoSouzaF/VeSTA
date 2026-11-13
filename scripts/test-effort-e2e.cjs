// E2E (real Claude and Codex, temporary data dir): the effort chosen for a chat is accepted by each CLI.
//   Each AI answers one short message with effort 'low', then one with 'max' (Codex runs it as xhigh).
// Usage: npx electron scripts/test-effort-e2e.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const data = require('./test-scratch.cjs')('effort');
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 4,
    settings: { memoryEnabled: false, capture: false, memoryTools: false },
    projects: [],
    chats: [],
    memories: [],
  })
);
process.env.VESTA_DATA_DIR = data;
process.env.VESTA_SERVICE_TEST = '1';
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const { app } = require('electron');
const { methods, getState } = require('../electron/main.cjs');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function answer(chatId, text) {
  await methods.send({ chatId, text });
  const t0 = Date.now();
  while (getState().running.includes(chatId)) {
    if (Date.now() - t0 > 180000) throw new Error('Tempo esgotado');
    await delay(500);
  }
  return getState()
    .chats.find((c) => c.id === chatId)
    .messages.at(-1);
}

app.whenReady().then(async () => {
  try {
    await methods.bootstrap();
    await methods.refreshConnections();
    for (const [provider, model] of [
      ['claude', 'claude-haiku-5-5'],
      ['codex', ''],
    ]) {
      const c = (await methods.createChat({ provider, model, mode: 'read' })).chats[0];
      for (const effort of ['low', 'max']) {
        await methods.updateChat({ id: c.id, effort });
        const a = await answer(c.id, 'Responda só a palavra PRONTO.');
        console.log(provider, effort, a.status, JSON.stringify((a.text || a.error || '').slice(0, 80)));
        assert.equal(a.status, 'done', a.error);
        assert.match(a.text, /PRONTO/i);
      }
    }
    console.log('PASS: Claude e Codex responderam com o esforço escolhido');
  } catch (e) {
    console.error('FAIL:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
