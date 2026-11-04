// E2E (real Claude, temporary data dir and project): a conversation asks VeSTA for a quest and it runs.
//   the chat calls vesta_quest_create (one Claude step, start=true) -> the quest is in the chat's project, starts by
//   itself, its step writes nota.txt in the project folder, and the quest ends done.
// Usage: npx electron scripts/test-chat-quest-e2e.cjs [claude-model]
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const model = process.argv.slice(2).find((a) => a.startsWith('claude-')) || 'claude-haiku-5-5';
const data = require('./test-scratch.cjs')('chat-quest'),
  projectDir = path.join(data, 'projeto');
fs.mkdirSync(projectDir, { recursive: true });
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 4,
    settings: { memoryEnabled: false, capture: false, memoryTools: false },
    projects: [{ id: 'proj', name: 'projeto', path: projectDir, createdAt: Date.now() }],
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
const until = async (what, fn, ms = 300000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await delay(1000);
  }
  throw new Error('Tempo esgotado: ' + what);
};

app.whenReady().then(async () => {
  try {
    await methods.bootstrap();
    await methods.refreshConnections();
    const c = (await methods.createChat({ provider: 'claude', model, projectId: 'proj', mode: 'edit' })).chats[0];
    await methods.send({
      chatId: c.id,
      text:
        'Use as ferramentas do VeSTA para criar uma quest chamada "Nota rápida", com uma única etapa feita pelo Claude ' +
        '(modelo ' +
        model +
        '), cujas instruções são: criar nesta pasta o arquivo nota.txt contendo exatamente OLA-QUEST. Inicie a quest agora. ' +
        'Depois só me diga o id da quest.',
    });
    await until('resposta do chat', () => !getState().running.includes(c.id));
    const answer = getState()
      .chats.find((x) => x.id === c.id)
      .messages.at(-1);
    console.log('Chat:', answer.status, JSON.stringify(answer.text.slice(0, 200)));
    assert.equal(answer.status, 'done', answer.error);
    assert.ok(
      answer.activities.some((a) => /vesta_quest_create/.test(a.label + ' ' + (a.detail || ''))),
      'o chat usou vesta_quest_create: ' + answer.activities.map((a) => a.label).join(' | ')
    );
    const quest = await until('quest criada', () => getState().quests.find((q) => q.title === 'Nota rápida'), 30000);
    assert.equal(quest.projectId, 'proj', 'a quest fica no projeto da conversa');
    const done = await until('quest concluída', () => {
      const q = getState().quests.find((x) => x.id === quest.id);
      console.log('  quest:', q.status, q.steps.map((s) => s.id + ':' + s.status).join(' '));
      return ['done', 'failed', 'cancelled', 'paused'].includes(q.status) && q;
    });
    assert.equal(done.status, 'done', JSON.stringify(done.log?.slice(-3)));
    assert.equal(fs.readFileSync(path.join(projectDir, 'nota.txt'), 'utf8').trim(), 'OLA-QUEST');
    console.log('PASS: o chat criou e iniciou a quest, que rodou até o fim no projeto');
  } catch (e) {
    console.error('FAIL:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
