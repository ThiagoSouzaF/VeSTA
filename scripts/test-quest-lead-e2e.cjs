// E2E (real AIs): the quest's own chat runs its quest through the vesta-quest MCP server.
//   A 2-step quest in a throwaway project; step 1 runs (Claude haiku) and leaves a code word at the START of a long
//   answer, then the quest is paused with step 2 pending. The person asks the quest chat (Claude haiku):
//   "troque a IA da etapa 2 para o Codex e me diga o que a etapa 1 respondeu".
// Checks, in the real app: step 2 changed provider through MCP (journal says it was the quest chat), the reply quotes the
// code word that only chat_read could see, both tools show in the chat's activities, step 1 and the quest status stayed.
// Uses a throwaway VESTA_DATA_DIR and project, never the installed app or %APPDATA%\VeSTA. Needs `npm run build`.
// Usage: node scripts/test-quest-lead-e2e.cjs [shots-dir]
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');

const root = path.join(__dirname, '..');
const shots = process.argv[2] || scratch('shots');
fs.mkdirSync(shots, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HAIKU = 'claude-haiku-5-5';
const CODE = 'ZEBRA-7731';

(async () => {
  const dataDir = scratch('quest-lead-e2e'),
    projectDir = path.join(dataDir, 'projeto');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'vesta.json'),
    JSON.stringify({
      version: 3,
      settings: { memoryEnabled: false, capture: false, memoryTools: false },
      projects: [{ id: 'proj', name: 'projeto-e2e', path: projectDir, createdAt: Date.now() }],
      chats: [],
      memories: [],
      quests: [],
    })
  );
  const env = { ...process.env, VESTA_DATA_DIR: dataDir, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1' };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const problems = [];
  try {
    const page = await mainWindow(app);
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    await page.waitForSelector('.loading', { state: 'detached' });
    await page.setViewportSize({ width: 1360, height: 900 });
    const call = (method, args) => page.evaluate(([m, a]) => window.vesta.call(m, a), [method, args]);
    const get = async () => (await call('bootstrap')).state;
    const boot = await call('bootstrap');
    assert.ok(boot.integrations.claude?.installed, 'Claude precisa estar instalado');
    assert.ok(boot.integrations.codex?.installed, 'O Codex precisa estar instalado para a troca da etapa 2');
    const pad = Array.from(
      { length: 45 },
      (_, i) => 'linha ' + (i + 1) + ': contagem de enchimento sem importância'
    ).join('\n');

    const created = await call('createQuest', {
      title: 'Nota com código',
      goal: 'Criar nota.txt e depois revisá-la.',
      guidelines: 'Trabalhe só dentro da pasta do projeto. Seja breve.',
      projectId: 'proj',
      maxParallel: 1,
      steps: [
        {
          id: 's1',
          title: 'Escrever a nota',
          provider: 'claude',
          model: HAIKU,
          mode: 'edit',
          instructions:
            'Crie o arquivo nota.txt contendo a frase "Código secreto: ' +
            CODE +
            '". Depois responda EXATAMENTE nesta forma: a primeira linha é "CÓDIGO: ' +
            CODE +
            '"; em seguida escreva estas 45 linhas, uma por linha, sem alterar nada:\n' +
            pad +
            '\nPor fim, uma seção "## Resultado" com uma linha: nota.txt criado.',
        },
        {
          id: 's2',
          title: 'Revisar a nota',
          provider: 'claude',
          model: HAIKU,
          mode: 'read',
          kind: 'review',
          dependsOn: ['s1'],
          instructions: 'Leia nota.txt e diga em uma linha se a frase está boa.',
        },
      ],
    });
    const questId = created.quests[0].id;
    await call('startQuest', { id: questId });
    await call('pauseQuest', { id: questId }); // step 1 keeps running; step 2 will wait
    console.log('quest iniciada e pausada; esperando a etapa 1…');
    let t0 = Date.now(),
      q;
    for (;;) {
      q = (await get()).quests.find((x) => x.id === questId);
      if (q.steps[0].status === 'done' || q.steps[0].status === 'error') break;
      assert.ok(Date.now() - t0 < 4 * 60000, 'a etapa 1 não terminou: ' + JSON.stringify(q.steps[0]));
      await wait(1500);
    }
    assert.equal(q.steps[0].status, 'done', 'etapa 1: ' + q.steps[0].result);
    assert.equal(q.status, 'paused');
    assert.equal(q.steps[1].status, 'pending');
    const s1chat = (await get()).chats.find((c) => c.id === q.steps[0].chatId);
    assert.ok(s1chat.messages.at(-1).text.includes(CODE), 'a etapa 1 deveria ter escrito o código na resposta');
    assert.ok(
      !q.steps[0].result.includes(CODE),
      'o resultado curto não pode conter o código (senão o chat_read não é necessário)'
    );
    console.log('etapa 1 pronta; resultado curto:', JSON.stringify(q.steps[0].result));

    // The quest's own chat, with Claude haiku.
    const opened = await call('questChat', { id: questId });
    const leadId = opened.chatId;
    await call('updateChat', { id: leadId, model: HAIKU });
    const lead0 = (await get()).chats.find((c) => c.id === leadId);
    assert.equal(lead0.questRole, 'lead');
    assert.equal(lead0.mode, 'read', 'o líder continua somente leitura');
    const ask =
      'Troque a IA da etapa 2 para o Codex e me diga o que a etapa 1 respondeu (inclua o código que aparece no começo da resposta dela).';
    await call('send', { chatId: leadId, text: ask });
    console.log('mensagem enviada ao chat da quest; esperando a resposta…');
    t0 = Date.now();
    for (;;) {
      const st = await get();
      const chat = st.chats.find((c) => c.id === leadId);
      if (
        !st.running.includes(leadId) &&
        chat.messages.at(-1)?.role === 'assistant' &&
        chat.messages.at(-1).status !== 'running'
      )
        break;
      assert.ok(Date.now() - t0 < 6 * 60000, 'o chat da quest não respondeu a tempo');
      await wait(2000);
    }
    const st = await get();
    q = st.quests.find((x) => x.id === questId);
    const lead = st.chats.find((c) => c.id === leadId);
    const reply = lead.messages.at(-1);
    console.log('resposta do líder:', JSON.stringify(reply.text.slice(0, 400)));
    console.log(
      'atividades do líder:',
      JSON.stringify((reply.activities || []).map((a) => a.label + ' | ' + (a.detail || '')))
    );
    assert.equal(reply.status, 'done', 'resposta: ' + (reply.error || reply.status));
    // 1. step 2 changed AI through the MCP server, and the journal says who did it.
    assert.equal(q.steps[1].provider, 'codex', 'a etapa 2 deveria usar o Codex; usa ' + q.steps[1].provider);
    assert.equal(q.steps[1].status, 'pending');
    assert.ok(
      q.log.some((e) => /Etapa "Revisar a nota" alterada \(chat da quest\).*IA claude → codex/.test(e.text)),
      'diário sem a troca'
    );
    // 2. the answer quotes what only chat_read could show.
    assert.ok(reply.text.includes(CODE), 'a resposta deveria citar ' + CODE);
    const labels = (reply.activities || []).map((a) => a.label + ' ' + (a.detail || '')).join('\n');
    assert.match(labels, /chat_read/, 'o líder deveria ter usado chat_read');
    assert.match(labels, /step_update/, 'o líder deveria ter usado step_update');
    // 3. nothing else moved.
    assert.equal(q.steps[0].status, 'done');
    assert.equal(q.steps[0].chatId, s1chat.id);
    assert.equal(q.status, 'paused');
    assert.deepEqual(fs.readdirSync(projectDir).sort(), ['nota.txt'], 'o líder não pode criar arquivos no projeto');
    assert.deepEqual(problems, [], 'erros no renderer:\n' + problems.join('\n'));

    // Screenshots: the board with step 2 on ChatGPT, and the quest chat with the tool calls.
    await page.locator('nav .nav-item', { hasText: 'Quests' }).click();
    await page.locator('.quest-row[data-quest="' + questId + '"]').click();
    await page.locator('.step-card[data-step=s2]').waitFor();
    await page.screenshot({ path: path.join(shots, 'q2-lead-board.png') });
    await page.locator('[data-action=quest-chat]').click();
    await page.waitForSelector('.chat-heading h2');
    await wait(800);
    await page.screenshot({ path: path.join(shots, 'q2-lead-tools.png') });
    const tools = page.locator('.message-tools > button, .activity-summary, [class*=activity]').first();
    if (await tools.count()) await tools.click().catch(() => {});
    await wait(500);
    await page.screenshot({ path: path.join(shots, 'q2-lead-tools-open.png') });
    // Second AI as the quest chat: Codex runs read-only too, and its read-only sandbox must not block the MCP tools.
    await call('switchProvider', { id: leadId, provider: 'codex' });
    await call('send', {
      chatId: leadId,
      text: 'Adicione ao plano uma etapa final chamada "Resumo final" (IA claude, modo read, instruções: "Resuma o resultado das etapas anteriores em uma linha.") que dependa da etapa 2. Depois diga o id da etapa nova.',
    });
    console.log('chat da quest agora com Codex; esperando a resposta…');
    t0 = Date.now();
    for (;;) {
      const st2 = await get();
      const chat = st2.chats.find((c) => c.id === leadId);
      if (
        !st2.running.includes(leadId) &&
        chat.messages.at(-1)?.role === 'assistant' &&
        chat.messages.at(-1).status !== 'running'
      )
        break;
      assert.ok(Date.now() - t0 < 8 * 60000, 'o Codex não respondeu a tempo');
      await wait(2000);
    }
    const st2 = await get();
    q = st2.quests.find((x) => x.id === questId);
    const codexReply = st2.chats.find((c) => c.id === leadId).messages.at(-1);
    console.log('resposta do Codex:', JSON.stringify(codexReply.text.slice(0, 300)));
    console.log(
      'atividades do Codex:',
      JSON.stringify((codexReply.activities || []).map((a) => a.label + ' | ' + (a.detail || '')))
    );
    assert.equal(codexReply.status, 'done', codexReply.error || codexReply.status);
    const added = q.steps.find((x) => x.title === 'Resumo final');
    assert.ok(added, 'o Codex deveria ter adicionado a etapa; etapas: ' + q.steps.map((x) => x.title).join(', '));
    assert.deepEqual(
      [added.provider, added.mode, added.status, added.dependsOn],
      ['claude', 'read', 'pending', ['s2']]
    );
    assert.ok(q.log.some((e) => /Etapa adicionada \(chat da quest\)/.test(e.text)));
    assert.deepEqual(
      fs.readdirSync(projectDir).sort(),
      ['nota.txt'],
      'o Codex líder não pode criar arquivos no projeto'
    );
    console.log('PASS: troca via MCP + chat_read (Claude) e step_add (Codex), líder somente leitura');
  } finally {
    await app.close().catch(() => {});
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
