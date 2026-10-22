// E2E (real AIs): a 3-step quest runs from start to finish on its own.
//   1. Claude (haiku) creates nota.txt  ->  2. another installed AI (Codex when available, else Claude haiku) reviews it
//   and writes revisao.txt  ->  3. Claude (haiku) summarizes, depending on both.
// Checks the files, the final status, the handoffs inside the step-3 prompt and the AI Memory pages.
// Uses a throwaway VESTA_DATA_DIR and project, never the installed app or %APPDATA%\VeSTA.
// Needs a fresh `npm run build`. Usage: node scripts/test-quest-e2e.cjs [shots-dir]
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

(async () => {
  const dataDir = scratch('quest-e2e'),
    projectDir = path.join(dataDir, 'projeto');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'vesta.json'),
    JSON.stringify({
      version: 3,
      settings: { memoryEnabled: true, capture: false, memoryTools: true },
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
  let page;
  try {
    page = await mainWindow(app);
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    await page.waitForSelector('.loading', { state: 'detached' });
    await page.setViewportSize({ width: 1360, height: 900 });
    const call = (method, args) => page.evaluate(([m, a]) => window.vesta.call(m, a), [method, args]);
    const boot = await call('bootstrap');
    assert.ok(boot.integrations.claude?.installed, 'Claude precisa estar instalado');
    const reviewer = boot.integrations.codex?.installed ? 'codex' : 'claude';
    console.log(
      'IAs: etapa 1 = claude haiku, etapa 2 =',
      reviewer,
      reviewer === 'claude' ? '(haiku)' : '(modelo padrão)',
      ', etapa 3 = claude haiku'
    );

    const state = await call('createQuest', {
      title: 'Nota e revisão',
      goal: 'Produzir nota.txt com uma frase, revisá-la em revisao.txt e resumir o resultado.',
      guidelines: 'Trabalhe só dentro da pasta do projeto. Seja breve. Não crie outros arquivos.',
      projectId: 'proj',
      maxParallel: 2,
      steps: [
        {
          id: 's1',
          title: 'Escrever a nota',
          provider: 'claude',
          model: HAIKU,
          mode: 'edit',
          instructions:
            'Crie o arquivo nota.txt na pasta atual contendo uma única frase curta em português sobre o outono. Não faça mais nada.',
        },
        {
          id: 's2',
          title: 'Revisar a nota',
          provider: reviewer,
          model: reviewer === 'claude' ? HAIKU : '',
          mode: 'edit',
          kind: 'review',
          dependsOn: ['s1'],
          instructions:
            'Leia nota.txt e crie o arquivo revisao.txt com uma ou duas linhas dizendo se a frase está boa. Não altere nota.txt.',
        },
        {
          id: 's3',
          title: 'Resumir tudo',
          provider: 'claude',
          model: HAIKU,
          mode: 'read',
          dependsOn: ['s1', 's2'],
          instructions:
            'Com base nos resultados das etapas anteriores, escreva em duas linhas o que foi produzido e o parecer da revisão. Não edite arquivos.',
        },
      ],
    });
    const questId = state.quests[0].id;
    await page.locator('nav .nav-item', { hasText: 'Quests' }).click();
    await page.locator('.quest-row[data-quest="' + questId + '"]').click();
    await page.locator('.plan-editor').waitFor();
    await page.screenshot({ path: path.join(shots, 'w3-quest-plan.png') });
    await page.locator('.plan-editor [data-action=start]').click();
    await page.locator('.quest-board').waitFor();

    const get = async () => (await call('bootstrap')).state;
    const t0 = Date.now(),
      timeline = [];
    let runShot = false,
      last = '',
      q;
    while (Date.now() - t0 < 9 * 60000) {
      const st = await get();
      q = st.quests.find((x) => x.id === questId);
      const line = q.status + ' ' + q.steps.map((s) => s.id + ':' + s.status).join(' ');
      if (line !== last) {
        last = line;
        timeline.push(Math.round((Date.now() - t0) / 1000) + 's ' + line);
        console.log(timeline.at(-1));
      }
      if (!runShot && q.steps.some((s) => s.status === 'running')) {
        runShot = true;
        await wait(1500);
        await page.screenshot({ path: path.join(shots, 'w3-quest-running.png') });
      }
      if (q.status === 'done' || q.status === 'paused' || q.status === 'cancelled' || q.status === 'failed') break;
      await wait(1000);
    }
    const st = await get();
    q = st.quests.find((x) => x.id === questId);
    assert.equal(
      q.status,
      'done',
      'status ' + q.status + ' · ' + q.steps.map((s) => s.id + ':' + s.status + ' ' + s.result).join(' | ')
    );
    assert.ok(runShot, 'a etapa nunca apareceu como rodando');
    await page.locator('.quest-status[data-status=done]').waitFor();
    await page.screenshot({ path: path.join(shots, 'w3-quest-done.png') });

    // Files really written by the AIs.
    const nota = fs.readFileSync(path.join(projectDir, 'nota.txt'), 'utf8').trim();
    const revisao = fs.readFileSync(path.join(projectDir, 'revisao.txt'), 'utf8').trim();
    assert.ok(nota.length > 5 && revisao.length > 5, 'arquivos vazios');
    console.log('nota.txt:', JSON.stringify(nota));
    console.log('revisao.txt:', JSON.stringify(revisao.slice(0, 160)));

    // Statuses, results, handoffs.
    assert.ok(
      q.steps.every((s) => s.status === 'done' && s.result && s.chatId),
      'todas as etapas concluídas com resultado'
    );
    const chat = (id) => st.chats.find((c) => c.id === id);
    const [c1, c2, c3] = q.steps.map((s) => chat(s.chatId));
    assert.match(c1.title, /^Quest: Nota e revisão — Escrever a nota/);
    assert.equal(c2.provider, reviewer);
    const prompt3 = c3.messages[0].text;
    assert.ok(prompt3.includes(q.steps[0].result), 'o prompt da etapa 3 contém o resultado da etapa 1');
    assert.ok(prompt3.includes(q.steps[1].result), 'o prompt da etapa 3 contém o resultado da etapa 2');
    assert.ok(chat(q.steps[1].chatId).messages[0].text.includes(q.steps[0].result), 'etapa 2 recebeu o resultado da 1');
    assert.ok(q.summary.includes('3 etapa'), 'resumo final');
    // Steps 1 and 2 are chained, so the review cannot start before the note is finished.
    assert.ok(q.steps[1].startedAt >= q.steps[0].endedAt, 'dependência respeitada');

    // AI Memory pages (written after each step).
    let notes = [];
    for (let i = 0; i < 40; i++) {
      notes = (await get()).memories.filter((n) => n.path.startsWith('quests/' + questId + '/'));
      if (notes.length >= 3) break;
      await wait(500);
    }
    assert.deepEqual(
      notes.map((n) => n.path).sort(),
      ['s1', 's2', 's3'].map((s) => 'quests/' + questId + '/' + s + '.md')
    );
    const word = (q.steps[0].result.match(/[\p{L}]{6,}/u) || ['nota'])[0];
    const found = await call('searchMemory', { query: word, projectId: 'proj' });
    console.log('AI Memory (busca "' + word + '"):', String(found).replace(/\s+/g, ' ').slice(0, 200));
    assert.ok(String(found).includes('quests/' + questId), 'a página da quest está no AI Memory');

    // Quest chats stay out of Conversas: the sidebar lists none of the 4 (quest chat + 3 steps).
    assert.ok(q.leadChatId && chat(q.leadChatId)?.questRole === 'lead', 'a quest tem um chat próprio');
    assert.equal(st.chats.filter((c) => c.questId === questId).length, 4);
    assert.equal(await page.locator('.chat-list .chat-list-item').count(), 0, 'chats da quest fora de Conversas');

    // The quest's own chat: opened from the board, lists every step chat and knows the whole quest.
    await call('updateChat', { id: q.leadChatId, model: HAIKU });
    await page.locator('.quest-controls [data-action=quest-chat]').click();
    await page.locator('.quest-chat-bar .quest-chat-step').nth(2).waitFor();
    assert.equal(await page.locator('.quest-chat-bar .quest-chat-step').count(), 3);
    await call('send', {
      chatId: q.leadChatId,
      text: 'Sem usar ferramentas: quantas etapas esta quest tem e qual IA fez a etapa "Revisar a nota"? Responda só no formato: N etapas; IA=<id da IA>',
    });
    let lead;
    for (let i = 0; i < 180; i++) {
      lead = (await get()).chats.find((c) => c.id === q.leadChatId);
      if (lead.messages.at(-1).status !== 'running') break;
      await wait(1000);
    }
    const answer = lead.messages.at(-1);
    console.log('chat da quest respondeu:', JSON.stringify(answer.text.slice(0, 160)));
    assert.equal(answer.status, 'done', answer.error || 'o chat da quest não terminou');
    assert.match(answer.text, /3 etapas/);
    assert.match(answer.text.toLowerCase(), new RegExp('ia\\s*=\\s*' + reviewer));
    assert.ok(answer.activities.some((a) => a.label === 'Quest consultada'));
    assert.ok(!lead.messages.at(-2).text.includes('<quest>'), 'o contexto da quest não aparece como fala do usuário');
    await page.screenshot({ path: path.join(shots, 'w3-quest-chat.png') });
    // Walk to a step chat and back to the board.
    await page.locator('.quest-chat-step[data-step=s2]').click();
    await page.locator('.quest-chat-bar [data-action=open-quest-chat]').waitFor();
    await page.locator('.quest-chat-bar [data-action=open-board]').click();
    await page.locator('.quest-detail[data-quest="' + questId + '"]').waitFor();

    // New chat: the model list follows the chosen AI.
    await page.locator('.new-chat').click();
    await page.locator('.modal-providers button', { hasText: 'Claude' }).click();
    const options = await page.locator('#model option').allTextContents();
    assert.ok(
      options.some((o) => o.includes(HAIKU)),
      'modelos do Claude no novo chat: ' + options.join(', ')
    );
    await page.locator('#model').selectOption(HAIKU);
    await page.screenshot({ path: path.join(shots, 'w3-new-chat-models.png') });
    await page.locator('.modal-footer .primary-button').click();
    await page.locator('.chat-list .chat-list-item').first().waitFor();
    const created = (await get()).chats.find((c) => !c.questId);
    assert.equal(created.model, HAIKU, 'o chat novo usa o modelo escolhido');
    assert.equal(await page.locator('.chat-list .chat-list-item').count(), 1, 'só o chat comum aparece em Conversas');

    const usage = q.steps.map((s) => s.id + ' ' + Math.round((s.endedAt - s.startedAt) / 1000) + 's');
    console.log('duração por etapa:', usage.join(', '), '· total', Math.round((Date.now() - t0) / 1000) + 's');
    assert.deepEqual(problems, [], problems.join('\n'));
    console.log('PASS: quest de 3 etapas concluída sozinha. Screenshots em ' + shots);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
    try {
      await page.screenshot({ path: path.join(shots, 'w3-quest-fail.png') });
    } catch {}
  } finally {
    await app.close().catch(() => {});
    await wait(500);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
