// E2E (Electron offscreen, no real AI): Agent Mode.
//   1. Agents on the rail; the overview shows the seeded agents (numbers, today's lanes, cards) in Tinta Mangá
//   2. a new agent from the form: name, AI, task, "Dias úteis" at a time, mode; the card shows the schedule
//   3. "Rodar agora": running on the card, then the result line, the diary, and the run's chat (outside Conversas)
//   4. the clock: an agent whose time comes runs by itself (trigger "agenda"); the rail badge, cleared on the screen
//   5. learning: an agent's "Lição:" lines and "Pedido sugerido:" wait for a yes in its drawer; what is kept (and a
//      lesson the person writes) reaches the next run, with the failures since the last success
//   6. off and on, and the Papel theme
// Needs a fresh `npm run build`. Usage: node scripts/test-agents-e2e.cjs
// Seeded agents are never due at launch: the fake driver is installed only after the window opens, so nothing may
// reach a real AI before it.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');

const root = path.join(__dirname, '..');
const data = scratch('agents');
const evidence = path.join(data, 'evidencias');
const projectDir = path.join(data, 'projeto-vesta');
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(projectDir, { recursive: true });
const now = Date.now();
const today = (h, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
// Earlier today when possible, so the lanes have something to draw (at 00:30 they fall back to "minutes ago").
const earlier = (h) => Math.min(today(h), now - 20 * 60000);
const run = (at, status, summary, extra = {}) => ({
  id: 'r' + at + status,
  at,
  endedAt: at + 95000,
  trigger: 'schedule',
  status,
  chatId: null,
  summary: status === 'ok' ? summary : '',
  error: status === 'error' ? summary : '',
  ...extra,
});
const AGENTS = [
  {
    id: 'a-faxina',
    name: 'Faxina da memória',
    prompt: 'Procure na memória páginas repetidas ou vencidas e proponha o que unir. Não apague nada.',
    provider: 'claude',
    model: '',
    projectId: null,
    mode: 'read',
    memory: true,
    skills: true,
    catchUp: true,
    enabled: true,
    schedule: { kind: 'interval', time: '08:30', days: [], hours: 6 },
    runs: [
      run(earlier(6), 'ok', 'Duas páginas sobre o Mora repetem a migração para Go: proponho unir.'),
      run(earlier(0), 'ok', 'Nada repetido desde ontem.'),
    ],
    nextRunAt: null,
    unseen: 0,
    createdAt: now - 7 * 86400000,
    updatedAt: now - 7 * 86400000,
  },
  {
    id: 'a-testes',
    name: 'Testes de toda noite',
    prompt: 'Rode npm test. Se algo falhar, investigue sem mudar código e diga a causa provável.',
    provider: 'claude',
    model: '',
    projectId: 'p1',
    mode: 'ask',
    memory: true,
    skills: true,
    catchUp: false,
    enabled: true,
    schedule: { kind: 'daily', time: '23:50', days: [], hours: 4 },
    runs: [run(earlier(2), 'error', 'test-remote-e2e: 2 falhas depois de subir o Electron.')],
    nextRunAt: null,
    unseen: 0,
    createdAt: now - 3 * 86400000,
    updatedAt: now - 3 * 86400000,
  },
  {
    id: 'a-seshat',
    name: 'Revisão do Seshat',
    prompt: 'Monte 10 perguntas do que estudei nesta semana.',
    provider: 'claude',
    model: '',
    projectId: null,
    mode: 'read',
    memory: true,
    skills: false,
    catchUp: true,
    enabled: false,
    schedule: { kind: 'weekly', time: '19:00', days: [2, 4], hours: 4 },
    runs: [],
    nextRunAt: null,
    unseen: 0,
    createdAt: now - 86400000,
    updatedAt: now - 86400000,
  },
];
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 5,
    settings: { memoryEnabled: false, capture: false, memoryTools: false, theme: 'ink', mascot: false },
    projects: [{ id: 'p1', name: 'VeSTA', path: projectDir, createdAt: now }],
    chats: [],
    memories: [],
    agents: AGENTS,
  })
);
const REPLY =
  'Li os commits de ontem.\n\nResumo: 3 commits ontem; comece pelo teste do quest-lead, que voltou a falhar.';
// What "Testes de toda noite" answers: two lessons and a better task.
const LEARNED = [
  'Rodei npm test: 2 falhas no test-remote-e2e, as duas por porta ocupada.',
  'Lição: o test-remote-e2e falha quando a porta 4319 está ocupada; confira antes de culpar o código.',
  'Lição: rode npm run build antes dos E2E, eles usam o dist.',
  'Pedido sugerido: Rode npm run build e depois npm test. Se algo falhar, confira portas ocupadas antes de investigar o código e diga a causa provável.',
  'Resumo: 2 falhas por porta ocupada, nada no código.',
].join('\n');

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
    env: {
      ...process.env,
      VESTA_DATA_DIR: data,
      VESTA_NO_UPDATE: '1',
      VESTA_NO_USAGE_REFRESH: '1',
      VESTA_AGENT_TICK_MS: '1000',
    },
  });
  try {
    const page = await mainWindow(app);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('.loading', { state: 'detached' });
    // No real AI: every turn answers REPLY after a short wait (long enough to see "rodando").
    await app.evaluate(
      (_, { electronDir, reply, learned }) => {
        const req = (f) => process.mainModule.require(electronDir + '/' + f);
        const main = req('main.cjs'),
          drivers = req('ai/drivers.cjs');
        for (const p of ['claude', 'codex'])
          main.ctx.integrations[p] = { installed: true, exe: 'fake-' + p + '.exe', models: [] };
        globalThis.__turns = [];
        drivers.start = (provider, spec, ctx) => {
          globalThis.__turns.push({ provider, prompt: ctx.prompt });
          const text = ctx.prompt.includes('agent "Testes de toda noite"') ? learned : reply;
          const done = {};
          setTimeout(() => {
            ctx.parse.accept({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
            ctx.parse.accept({ type: 'result', result: text, num_turns: 1 });
            done.resolve({ code: 0, stderr: '' });
          }, 1800);
          return { done: new Promise((r) => (done.resolve = r)), stop() {} };
        };
      },
      {
        electronDir: path.join(root, 'electron').split(String.fromCharCode(92)).join('/'),
        reply: REPLY,
        learned: LEARNED,
      }
    );
    const turns = () => app.evaluate(() => globalThis.__turns);
    const state = () => page.evaluate(async () => (await window.vesta.call('bootstrap')).state);
    // Polls the main process state (page.waitForFunction does not wait for an async predicate).
    const agentUntil = async (id, ok, ms = 20000) => {
      for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(300)) {
        const a = (await state()).agents.find((x) => x.id === id);
        if (ok(a)) return a;
      }
      throw new Error('timed out waiting for agent ' + id);
    };
    const shot = async (name) => {
      await page.waitForTimeout(700); // entrances settle (motion.css) before the picture
      await page.screenshot({ path: path.join(evidence, name + '.png') });
    };
    const card = (name) => page.locator('.agent-card[data-agent="' + name + '"]');

    await step('Agents on the rail: numbers, today, cards', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Agents' }).click();
      await page.getByRole('heading', { name: 'Trabalham enquanto você não está.' }).waitFor();
      const strip = await page.locator('.agents-strip').innerText();
      assert.match(strip, /2\s*ativos/);
      assert.match(strip, /1\s*com falha/);
      assert.match(strip, /Próximo:/);
      assert.equal(await page.locator('.agent-lane').count(), 3);
      assert.ok((await page.locator('.agent-lane[data-lane="Faxina da memória"] .agent-mark.ok').count()) >= 1);
      assert.ok((await page.locator('.agent-mark.planned').count()) >= 1, 'something is planned today');
      assert.match(await card('Testes de toda noite').innerText(), /falhou[\s\S]*2 falhas/);
      assert.match(await card('Revisão do Seshat').innerText(), /inativo[\s\S]*Ter e qui às 19:00/);
      assert.equal(await page.locator('.agents-tabs [data-filter="off"] .skills-n').innerText(), '1');
      // The next times were computed at start (seeded as null).
      assert.ok((await state()).agents.every((a) => !a.enabled || a.nextRunAt > Date.now()));
      await shot('1-visao-geral-tinta');
    });

    await step('a new agent from the form', async () => {
      await page.getByRole('button', { name: 'Novo agent' }).first().click();
      await page.locator('.agent-drawer[aria-label="Novo agent"]').waitFor();
      await page.locator('#agent-name').fill('Bom dia do VeSTA');
      await page.locator('.agent-ais [data-ai="claude"]').click();
      await page.getByLabel('Projeto', { exact: true }).selectOption('p1');
      await page.locator('#agent-prompt').fill('Leia os commits de ontem e me diga o que fazer primeiro hoje.');
      await page.locator('.agent-seg [data-kind="weekly"]').click();
      await page.getByRole('button', { name: 'seg', exact: true }).click(); // seg, qua, sex -> qua, sex
      assert.match(await page.locator('.agent-preview').innerText(), /^Qua e sex às 08:30 · próxima:/);
      await page.locator('.agent-seg [data-kind="weekdays"]').click();
      await page.getByLabel('Hora', { exact: true }).fill('07:45');
      assert.match(await page.locator('.agent-preview').innerText(), /^Dias úteis às 07:45/);
      await page.locator('.agent-modes [data-mode="read"]').click();
      // Its own skill: /ui-revamp ships with VeSTA, so the library has it.
      await page.locator('.agent-skill-pick [data-skill="ui-revamp"]').click();
      assert.equal(
        await page.locator('.agent-skill-pick [data-skill="ui-revamp"]').getAttribute('aria-pressed'),
        'true'
      );
      await shot('2-novo-agent');
      await page.getByRole('button', { name: 'Criar agent' }).click();
      await page.locator('.agent-drawer[data-agent="Bom dia do VeSTA"] .agent-diary').waitFor();
      const a = (await state()).agents.find((x) => x.name === 'Bom dia do VeSTA');
      assert.equal(a.provider, 'claude');
      assert.equal(a.projectId, 'p1');
      assert.deepEqual(a.schedule, { kind: 'weekdays', time: '07:45', days: [], hours: 4 });
      assert.ok(a.nextRunAt > Date.now());
      assert.equal(new Date(a.nextRunAt).getHours(), 7);
      assert.deepEqual(a.skillNames, ['ui-revamp']);
      assert.match(await page.locator('.agent-drawer .agent-skill-chips').innerText(), /\/ui-revamp/);
    });

    await step('"Rodar agora": running, then the result, the diary and the chat outside Conversas', async () => {
      await page.locator('.agent-drawer').getByRole('button', { name: 'Rodar agora' }).click();
      await page.locator('.agent-drawer .agent-status.running').first().waitFor();
      await page.keyboard.press('Escape');
      await card('Bom dia do VeSTA').locator('.agent-status.running').waitFor();
      await shot('3-rodando');
      await card('Bom dia do VeSTA').locator('.agent-status.ok').waitFor({ timeout: 15000 });
      assert.match(await card('Bom dia do VeSTA').innerText(), /3 commits ontem; comece pelo teste do quest-lead/);
      const t = (await turns()).at(-1);
      assert.equal(t.provider, 'claude');
      assert.match(t.prompt, /agent "Bom dia do VeSTA"/);
      assert.match(t.prompt, /Não publique nada fora deste computador/);
      assert.match(t.prompt, /## Tarefa\nLeia os commits de ontem/);
      assert.match(
        t.prompt,
        /## Skills deste agent[\s\S]*<skill nome="ui-revamp">\n[\s\S]+<\/skill>/,
        'its skill, whole'
      );
      const s = await state();
      const a = s.agents.find((x) => x.name === 'Bom dia do VeSTA');
      const chat = s.chats.find((c) => c.id === a.runs[0].chatId);
      assert.equal(chat.agentId, a.id);
      assert.equal(chat.projectId, 'p1');
      assert.equal(chat.mode, 'read');
      await card('Bom dia do VeSTA').click();
      await page.locator('.agent-run-row.ok').first().waitFor();
      assert.match(await page.locator('.agent-run-row.ok').first().innerText(), /você pediu/);
      await shot('4-diario');
      await page.locator('.agent-run-row.ok').first().getByRole('button', { name: 'Abrir conversa' }).click();
      await page.locator('.message').filter({ hasText: '3 commits ontem' }).first().waitFor();
      // Not in the Conversas drawer: it lives in the agent's diary.
      if (!(await page.locator('.conversation-drawer').isVisible())) await page.keyboard.press('Control+b');
      await page.locator('.conversation-drawer').waitFor();
      assert.equal(await page.locator('.conversation-drawer').getByText(chat.title).count(), 0);
    });

    await step('the clock runs an agent when its time comes; the rail badge, cleared on the screen', async () => {
      await page.locator('.rail-item').filter({ hasText: 'Início' }).click();
      await page.locator('.agents-page').waitFor({ state: 'detached', timeout: 5000 });
      const before = (await turns()).length;
      await app.evaluate(
        ({}, id) => {
          const main = process.mainModule.require(id.dir + '/main.cjs');
          const a = main.ctx.store.state.agents.find((x) => x.id === id.id);
          a.nextRunAt = Date.now() + 1500;
        },
        { id: 'a-faxina', dir: path.join(root, 'electron').split(String.fromCharCode(92)).join('/') }
      );
      // Two seeded runs: the third is the clock's.
      await agentUntil('a-faxina', (a) => a.runs.length === 3 && a.runs[0].status === 'ok');
      assert.equal((await turns()).length, before + 1);
      const a = (await state()).agents.find((x) => x.id === 'a-faxina');
      assert.equal(a.runs[0].trigger, 'schedule');
      assert.ok(a.nextRunAt > Date.now() + 5 * 3600000, 'next one in 6 h');
      assert.ok(a.unseen >= 1);
      const badge = page.locator('.rail-item').filter({ hasText: 'Agents' }).locator('.count');
      await badge.waitFor();
      await page.locator('.rail-item').filter({ hasText: 'Agents' }).click();
      await badge.waitFor({ state: 'detached' });
      assert.ok((await state()).agents.every((x) => !x.unseen));
      assert.match(await card('Faxina da memória').innerText(), /3 commits ontem/);
    });

    await step('learning: lessons and a suggested task wait for a yes; what is kept reaches the next run', async () => {
      const before = (await turns()).length;
      await card('Testes de toda noite').getByRole('button', { name: 'Rodar Testes de toda noite agora' }).click();
      await agentUntil('a-testes', (a) => a.runs[0].status === 'ok');
      const first = (await turns())[before];
      assert.match(first.prompt, /falharam desde a última que deu certo\n- .+: test-remote-e2e: 2 falhas/);
      assert.doesNotMatch(first.prompt, /aprovado pela pessoa/);
      await card('Testes de toda noite').locator('.agent-review').waitFor();
      assert.equal(await card('Testes de toda noite').locator('.agent-review').innerText(), '3 para revisar');
      assert.match(await page.locator('.agents-strip').innerText(), /3\s*aprendizados para revisar/);
      await card('Testes de toda noite').click();
      const drawer = page.locator('.agent-drawer[data-agent="Testes de toda noite"]');
      await drawer.locator('.agent-suggestion').waitFor();
      assert.equal(await drawer.locator('[data-lesson="pending"]').count(), 2);
      await shot('5-aprendeu');
      await drawer.getByRole('button', { name: /^Manter a lição: o test-remote-e2e/ }).click();
      await drawer.locator('[data-lesson="kept"]').waitFor();
      await drawer.getByRole('button', { name: /^Apagar a lição: rode npm run build/ }).click();
      await drawer.locator('[data-lesson="pending"]').waitFor({ state: 'detached' });
      await drawer.getByLabel('Ensinar uma lição').fill('Nunca rode o deploy');
      await drawer.getByRole('button', { name: 'Ensinar' }).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-lesson="kept"]').length === 2);
      await drawer.getByRole('button', { name: 'Usar este pedido' }).click();
      await drawer.locator('.agent-suggestion').waitFor({ state: 'detached' });
      assert.match(await drawer.locator('.agent-prompt').innerText(), /^Rode npm run build e depois npm test/);
      const a = (await state()).agents.find((x) => x.id === 'a-testes');
      assert.deepEqual(
        a.lessons.map((l) => [l.status, l.from]),
        [
          ['kept', 'person'],
          ['dropped', 'run'],
          ['kept', 'run'],
        ]
      );
      assert.equal(a.suggestion, null);
      await page.keyboard.press('Escape');
      await card('Testes de toda noite').locator('.agent-review').waitFor({ state: 'detached' });
      // The next run carries what was kept and the new task; the last run worked, so no failures.
      await card('Testes de toda noite').getByRole('button', { name: 'Rodar Testes de toda noite agora' }).click();
      await agentUntil('a-testes', (x) => x.runs.length === 3 && x.runs[0].status === 'ok');
      const next = (await turns()).at(-1).prompt;
      assert.match(
        next,
        /aprovado pela pessoa\)\n- Nunca rode o deploy\n- o test-remote-e2e falha quando a porta 4319/
      );
      assert.doesNotMatch(next, /rode npm run build antes dos E2E/, 'the dropped lesson is gone');
      assert.doesNotMatch(next, /falharam desde/);
      assert.match(next, /## Tarefa\nRode npm run build e depois npm test\./);
      // The same answer again: lessons it has, or that were dropped, are not proposed again; the suggestion is the
      // task itself.
      const again = (await state()).agents.find((x) => x.id === 'a-testes');
      assert.equal(again.lessons.filter((l) => l.status === 'pending').length, 0, 'not even the dropped one');
      assert.equal(again.suggestion, null);
    });

    await step('off and on; Papel', async () => {
      await card('Faxina da memória').getByRole('switch').click();
      await agentUntil('a-faxina', (a) => !a.enabled && a.nextRunAt === null, 5000);
      await card('Faxina da memória').locator('.agent-status.off').waitFor();
      await card('Faxina da memória').getByRole('switch').click();
      await card('Faxina da memória').locator('.agent-status.ok').waitFor();
      await page.locator('.agents-tabs [data-filter="off"]').click();
      assert.equal(await page.locator('.agent-card[data-agent]').count(), 1);
      await page.locator('.agents-tabs [data-filter="all"]').click();
      await page.evaluate(() => window.vesta.call('saveSettings', { theme: 'paper' }));
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
      await shot('6-visao-geral-papel');
      await card('Testes de toda noite').click();
      await page.locator('.agent-drawer[data-agent="Testes de toda noite"]').waitFor();
      await shot('7-gaveta-papel');
    });
  } finally {
    await app.close();
  }
  console.log('evidências: ' + evidence);
  if (failed) {
    process.exitCode = 1;
    console.log(failed + ' passo(s) falharam');
  } else console.log('Agents E2E: tudo certo');
})();
