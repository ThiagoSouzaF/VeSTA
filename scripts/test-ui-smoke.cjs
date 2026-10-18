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

// ---- Phase 3: Activity screen with live work across 3 chats / 3 AIs ------------------------------------------
// Synthetic state injected through the same event the app uses for snapshots (nothing is sent to an AI).
function activityState(base) {
  const now = Date.now();
  const chat = (id, title, provider, projectId, messages) => ({
    id,
    title,
    provider,
    model: '',
    agent: '',
    projectId,
    mode: 'edit',
    messages,
    sessionId: null,
    createdAt: now - 600000,
    updatedAt: now,
    memory: false,
  });
  const user = (id) => ({ id, role: 'user', text: 'faça o trabalho', createdAt: now - 60000 });
  const asst = (id, provider, status, extra) => ({
    id,
    role: 'assistant',
    text: status === 'running' ? '' : 'Pronto.',
    createdAt: now - 50000,
    status,
    provider,
    model: '',
    activities: [],
    subagents: [],
    ...extra,
  });
  const act = (id, kind, label, detail, status, ago, extra = {}) => ({
    id,
    kind,
    label,
    detail,
    status,
    startedAt: now - ago,
    ...(status === 'running' ? {} : { endedAt: now - ago + 1500 }),
    ...extra,
  });
  return {
    ...base,
    projects: [{ id: 'p1', name: 'meu-projeto', path: 'C:\\meu-projeto', createdAt: now }],
    running: ['act-claude', 'act-opencode'],
    chats: [
      chat('act-claude', 'Refatorar o backend', 'claude', 'p1', [
        user('u1'),
        asst('m-claude', 'claude', 'running', {
          activities: [
            act('b1', 'command', 'Usando Bash', 'npm run dev', 'running', 40000, {
              background: true,
              taskId: 'tb1',
              title: 'Servidor de desenvolvimento',
            }),
            act('c1', 'command', 'Usando Bash', 'git status', 'done', 45000),
            act('f1', 'file', 'Usando Read', 'src/app.js', 'done', 44000),
          ],
          subagents: [
            {
              toolUseId: 'sa1',
              subagentType: 'Explore',
              label: 'Mapear rotas da API',
              prompt: 'Liste as rotas',
              status: 'running',
              background: true,
              taskId: 'ta1',
              startedAt: now - 30000,
              steps: [
                {
                  id: 's1',
                  kind: 'command',
                  label: 'Usando Bash',
                  detail: 'grep -rn route',
                  status: 'running',
                  startedAt: now - 5000,
                },
                {
                  id: 's2',
                  kind: 'file',
                  label: 'Usando Read',
                  detail: 'routes.js',
                  status: 'done',
                  startedAt: now - 20000,
                  endedAt: now - 19000,
                },
              ],
            },
          ],
        }),
      ]),
      chat('act-codex', 'Corrigir testes', 'codex', null, [
        user('u2'),
        asst('m-codex', 'codex', 'done', {
          endedAt: now - 300000,
          createdAt: now - 400000,
          activities: [
            act('x1', 'command', 'Comando concluído', 'npm test', 'done', 380000),
            act('x2', 'command', 'Comando concluído', 'npm run lint', 'error', 370000),
          ],
        }),
      ]),
      chat('act-opencode', 'Buscar documentação', 'opencode', null, [
        user('u3'),
        asst('m-opencode', 'opencode', 'running', {
          activities: [
            act('o1', 'mcp', 'Consultando ferramenta', 'docs · search', 'running', 8000),
            act('o2', 'web', 'Usando webfetch', 'https://example.com', 'done', 12000),
          ],
        }),
      ]),
    ],
  };
}
async function activityPhase() {
  const dataDir = scratch('ui-smoke-activity');
  const app = await launch(dataDir);
  const problems = [];
  try {
    const page = await app.firstWindow();
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    const nav = (name) => page.locator('nav .nav-item', { hasText: name });
    const inject = (ev) =>
      app.evaluate(({ BrowserWindow }, e) => BrowserWindow.getAllWindows()[0].webContents.send('vesta:event', e), ev);
    const chip = (kind) => page.locator('.activity-chip[data-kind="' + kind + '"] strong');
    const groupIds = () => page.locator('.activity-group').evaluateAll((els) => els.map((e) => e.dataset.chat));
    const chipIs = (kind, n) =>
      page.waitForFunction(
        ([k, v]) => document.querySelector('.activity-chip[data-kind="' + k + '"] strong')?.textContent === v,
        [kind, String(n)]
      );
    await page.waitForSelector('.loading', { state: 'detached' });
    const boot = await page.evaluate(() => window.vesta.call('bootstrap'));
    await inject({ type: 'state', state: activityState(boot.state) });

    await step('sidebar shows the running-task counter and a badge on chats with running tasks', async () => {
      await page.waitForFunction(() => document.querySelectorAll('.chat-list-item').length === 3);
      // claude: background command + subagent + its running step = 3; opencode: 1 MCP call
      await page.waitForFunction(() => document.querySelector('nav .count.live')?.textContent === '4');
      const item = page.locator('.chat-list-item', { hasText: 'Refatorar o backend' });
      assert.equal(await item.locator('.task-badge').innerText(), '3');
      assert.equal(
        await page.locator('.chat-list-item', { hasText: 'Corrigir testes' }).locator('.task-badge').count(),
        0
      );
    });
    await step('Atividade lists the live chats with summary counters', async () => {
      await nav('Atividade').click();
      await page.locator('h1', { hasText: 'O que está acontecendo.' }).waitFor();
      assert.deepEqual((await groupIds()).sort(), ['act-claude', 'act-opencode']);
      assert.equal(await chip('working').innerText(), '2');
      assert.equal(await chip('subagents').innerText(), '1');
      assert.equal(await chip('commands').innerText(), '1');
      assert.equal(await chip('background').innerText(), '1');
    });
    await step('the tree nests turn -> subagent -> step and shows live state and elapsed time', async () => {
      const g = page.locator('.activity-group[data-chat="act-claude"]');
      assert.match(await g.innerText(), /meu-projeto/);
      assert.match(await g.innerText(), /Claude/);
      assert.equal(await g.locator('.task-node[data-kind="subagent"][data-status="running"]').count(), 1);
      assert.equal(await g.locator('.task-node[data-kind="background"][data-status="running"]').count(), 1);
      assert.equal(
        await g.locator('.task-node[data-kind="subagent"] .task-node[data-kind="command"]').count(),
        1,
        'step inside subagent'
      );
      assert.match(
        await g.locator('.task-node[data-kind="background"] .task-time').first().innerText(),
        /^\d+s$|^\d+m/
      );
      assert.ok((await g.locator('.spin').count()) >= 3, 'animated spinners on running tasks');
    });
    await step('clicking a task expands its details (command, prompt)', async () => {
      const g = page.locator('.activity-group[data-chat="act-claude"]');
      await g.locator('.task-node[data-kind="background"] .task-main').click();
      assert.match(await g.locator('.task-detail').first().innerText(), /npm run dev/);
      await g.locator('.task-node[data-kind="subagent"] > .task-row .task-main').click();
      assert.match(await g.locator('.task-detail', { hasText: 'Liste as rotas' }).innerText(), /PROMPT/);
    });
    await step('stop is offered per live chat and per trackable Claude task only', async () => {
      assert.equal(await page.locator('.activity-stop').count(), 2);
      const g = page.locator('.activity-group[data-chat="act-claude"]');
      assert.equal(await g.locator('.task-stop').count(), 2, 'background command and subagent have task ids');
      assert.equal(
        await page.locator('.activity-group[data-chat="act-opencode"] .task-stop').count(),
        0,
        'OpenCode tasks cannot be stopped one by one'
      );
    });
    await step('Tudo adds the recent finished chat; the AI filter narrows groups', async () => {
      await page.getByRole('tab', { name: 'Tudo' }).click();
      assert.deepEqual((await groupIds()).sort(), ['act-claude', 'act-codex', 'act-opencode']);
      assert.equal(
        await page.locator('.activity-group[data-chat="act-codex"] .task-node[data-status="error"]').count(),
        1
      );
      await page.getByRole('tab', { name: 'ChatGPT' }).click();
      assert.deepEqual(await groupIds(), ['act-codex']);
      await page.getByRole('tab', { name: 'Todas as IAs' }).click();
      await page.getByRole('tab', { name: 'Rodando' }).click();
      assert.equal((await groupIds()).length, 2);
    });
    await step('live events update the screen: the background command ends and counters drop', async () => {
      await inject({
        type: 'activity',
        chatId: 'act-claude',
        messageId: 'm-claude',
        activity: { id: 'b1', status: 'done', endedAt: Date.now() },
      });
      await chipIs('background', 0);
      assert.equal(
        await page
          .locator('.activity-group[data-chat="act-claude"] .task-node[data-kind="background"][data-status="done"]')
          .count(),
        1
      );
      await page.waitForFunction(() => document.querySelector('nav .count.live')?.textContent === '3');
      await inject({
        type: 'subagent',
        chatId: 'act-claude',
        messageId: 'm-claude',
        subagent: {
          toolUseId: 'sa1',
          status: 'done',
          endedAt: Date.now(),
          step: { id: 's1', status: 'done', endedAt: Date.now() },
        },
      });
      await chipIs('subagents', 0);
      assert.equal(await chip('working').innerText(), '2', 'the turn itself is still running');
    });
    await step('clicking a group opens the chat; the message shows the summary line and the same tree', async () => {
      await page.locator('.activity-group[data-chat="act-claude"] .activity-group-title').click();
      await page.waitForSelector('.chat-heading h2');
      assert.equal(await page.locator('.chat-heading h2').innerText(), 'Refatorar o backend');
      const line = page.locator('.task-summary-line');
      assert.match(await line.innerText(), /1 subagente · 2 comandos · 1 em segundo plano · 2 ferramentas/);
      await line.click();
      assert.ok((await page.locator('.task-summary .task-node').count()) >= 4);
    });
    await step('a chat that was running when the app closed shows as stopped, not live', async () => {
      const st = activityState((await page.evaluate(() => window.vesta.call('bootstrap'))).state);
      st.running = [];
      await inject({ type: 'state', state: st });
      await page.waitForFunction(() => !document.querySelector('nav .count.live'));
      await nav('Atividade').click();
      await page.locator('.activity-empty').waitFor();
    });
    await wait(400);
    assert.deepEqual(problems, [], 'renderer reported errors:\n' + problems.join('\n'));
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ---- Phase 4: Quests (seeded store; nothing is sent to an AI) ----------------------------------------------------
const Q = require('../electron/quests.cjs');
function questStore(dataDir) {
  const now = Date.now();
  const chat = (id, title, provider, stepId, questId, text) => ({
    id,
    title,
    provider,
    model: '',
    agent: '',
    projectId: null,
    mode: 'edit',
    questId,
    stepId,
    messages: [
      { id: id + 'u', role: 'user', text: 'prompt da etapa', createdAt: now - 5000 },
      {
        id: id + 'a',
        role: 'assistant',
        text,
        createdAt: now - 4000,
        activities: [{ id: 'c1', kind: 'command', label: 'Executando comando', detail: 'ls', status: 'done' }],
        subagents: [],
        status: 'done',
        provider,
        model: '',
      },
    ],
    sessionId: null,
    createdAt: now - 6000,
    updatedAt: now,
    memory: false,
  });
  const step = (id, title, o) => ({ id, title, instructions: 'faça ' + title, ...o });
  const quest = Q.normalizeQuest({
    id: 'quest-1',
    title: 'Site de contato',
    goal: 'Criar a página de contato com testes.',
    guidelines: 'Sem dependências novas.',
    status: 'running',
    createdAt: now - 60000,
    steps: [
      step('s1', 'Criar a página', {
        provider: 'claude',
        model: 'claude-haiku-5-5',
        status: 'done',
        chatId: 'qc1',
        startedAt: now - 50000,
        endedAt: now - 30000,
        attempts: 1,
        result: 'Criei contato.html com formulário.',
      }),
      step('s2', 'Revisar a página', {
        provider: 'codex',
        kind: 'review',
        mode: 'read',
        dependsOn: ['s1'],
        status: 'running',
        chatId: 'qc2',
        startedAt: now - 20000,
        attempts: 1,
      }),
      step('s3', 'Resumir', { provider: 'claude', dependsOn: ['s1', 's2'] }),
    ],
    log: [{ at: now - 50000, text: 'Quest iniciada.' }],
  });
  const other = Q.normalizeQuest({
    id: 'quest-2',
    title: 'Migrar relatórios',
    goal: 'Migrar os relatórios.',
    status: 'done',
    summary: 'Quest "Migrar relatórios" concluída: 1 etapa(s) feita(s).',
    steps: [
      step('s1', 'Migrar', { status: 'done', result: 'ok', startedAt: now - 9000, endedAt: now - 3000, attempts: 1 }),
    ],
  });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'vesta.json'),
    JSON.stringify({
      version: 3,
      settings: { memoryEnabled: false, capture: false, memoryTools: false },
      projects: [],
      chats: [
        chat(
          'qc1',
          'Quest: Site de contato — Criar a página',
          'claude',
          's1',
          'quest-1',
          'Pronto.\n\n## Resultado\nCriei contato.html com formulário.'
        ),
        chat('qc2', 'Quest: Site de contato — Revisar a página', 'codex', 's2', 'quest-1', 'Revisando…'),
      ],
      memories: [],
      quests: [quest, other],
    })
  );
}
async function questPhase() {
  const dataDir = scratch('ui-smoke-quests');
  questStore(dataDir);
  const app = await launch(dataDir);
  const problems = [];
  try {
    const page = await app.firstWindow();
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    const nav = (name) => page.locator('nav .nav-item', { hasText: name });
    const inject = (ev) =>
      app.evaluate(({ BrowserWindow }, e) => BrowserWindow.getAllWindows()[0].webContents.send('vesta:event', e), ev);
    const col = (id) => page.locator('.quest-col[data-col="' + id + '"]');
    await page.waitForSelector('.loading', { state: 'detached' });

    await step('Quests appears in the sidebar and lists both quests with progress', async () => {
      await nav('Quests').click();
      await page.locator('h1', { hasText: 'Dê uma quest às suas IAs.' }).waitFor();
      assert.equal(await page.locator('.quest-row').count(), 2);
      const row = page.locator('.quest-row[data-quest="quest-1"]');
      assert.match(await row.innerText(), /Site de contato/);
      assert.match(await row.innerText(), /1\/3 etapas/);
      assert.equal(await row.locator('.provider-icon').count(), 2, 'Claude and ChatGPT involved');
      assert.equal(await row.locator('[role=progressbar]').getAttribute('aria-valuenow'), '33');
    });
    await step('reopening the app paused the quest that was "running" and flagged the orphan step', async () => {
      const row = page.locator('.quest-row[data-quest="quest-1"]');
      assert.equal(await row.locator('.quest-status').getAttribute('data-status'), 'paused');
      await row.click();
      await page.locator('h1', { hasText: 'Site de contato' }).waitFor();
      assert.equal(await col('problems').locator('.step-card').count(), 1);
      assert.match(await col('problems').innerText(), /interrompida/);
      assert.equal(await col('done').locator('.step-card').count(), 1);
      assert.equal(await col('pending').locator('.step-card').count(), 1);
      assert.equal(await col('running').locator('.step-card').count(), 0);
    });
    await step('paused board offers Retomar, Cancelar, Tentar de novo and Pular', async () => {
      const bar = page.locator('.quest-controls');
      assert.equal(await bar.locator('[data-action=resume]').isVisible(), true);
      assert.equal(await bar.locator('[data-action=cancel]').isVisible(), true);
      assert.equal(await col('problems').locator('[data-action=retry]').isVisible(), true);
      assert.equal(await col('problems').locator('[data-action=skip]').isVisible(), true);
      assert.equal((await page.locator('.quest-log li').count()) >= 2, true, 'journal has entries');
    });
    await step('a running quest shows the running card, Pausar and the sidebar counter', async () => {
      const st = (await page.evaluate(() => window.vesta.call('bootstrap'))).state;
      const q = st.quests.find((x) => x.id === 'quest-1');
      q.status = 'running';
      q.pauseReason = null;
      q.steps[1] = { ...q.steps[1], status: 'running', result: '', endedAt: null };
      q.updatedAt = Date.now();
      st.running = ['qc2'];
      await inject({ type: 'state', state: st });
      await page.waitForFunction(() => document.querySelector('nav .count.live')?.textContent === '1');
      assert.equal(await col('running').locator('.step-card').count(), 1);
      assert.match(await col('running').innerText(), /Revisar a página/);
      assert.match(await col('running').innerText(), /Criar a página/);
      assert.equal(await page.locator('.quest-controls [data-action=pause]').isVisible(), true);
      assert.equal(await page.locator('.quest-controls [data-action=resume]').count(), 0);
      assert.equal(await col('running').locator('.quest-time').count(), 1, 'elapsed time on the running card');
      await page.screenshot({ path: path.join(process.env.VESTA_SHOTS || scratch('shots'), 'w3-smoke-board.png') });
    });
    await step('a step card links to its chat', async () => {
      await col('done').locator('[data-action=open-chat]').click();
      await page.waitForSelector('.chat-heading h2');
      assert.equal(await page.locator('.chat-heading h2').innerText(), 'Quest: Site de contato — Criar a página');
    });
    await step('Atividade shows quest chats by their quest name', async () => {
      await nav('Atividade').click();
      await page.getByRole('tab', { name: 'Tudo' }).click();
      await page.locator('.activity-group-title', { hasText: 'Quest: Site de contato' }).first().waitFor();
    });
    await step('finished quest shows its final summary and no run controls', async () => {
      await nav('Quests').click();
      await page.locator('.quest-row[data-quest="quest-2"]').click();
      assert.match(await page.locator('.quest-summary').innerText(), /concluída/);
      assert.equal(await page.locator('.quest-controls [data-action=pause], [data-action=resume]').count(), 0);
      await page.locator('.quest-back').click();
    });
    await step('new quest: manual assembly, plan editor (add, depend, reorder, remove)', async () => {
      await page.locator('[data-action=new-quest]').click();
      const dlg = page.getByRole('dialog');
      await dlg.locator('#quest-title').fill('Quest manual');
      assert.equal(await dlg.getByRole('button', { name: /Montar manualmente/ }).isDisabled(), true, 'goal required');
      await dlg.locator('#quest-goal').fill('Meta de teste');
      await dlg.getByRole('button', { name: /Planejar com IA/ }).waitFor();
      await dlg.getByRole('button', { name: /Montar manualmente/ }).click();
      await page.locator('h1', { hasText: 'Quest manual' }).waitFor();
      const editor = page.locator('.plan-editor');
      assert.equal(await editor.locator('[data-action=start]').isDisabled(), true, 'no steps yet');
      await editor.getByRole('button', { name: /Adicionar etapa/ }).click();
      await editor.getByRole('button', { name: /Adicionar etapa/ }).click();
      await editor.getByLabel('Título da etapa 1').fill('Primeira');
      await editor.getByLabel('Instruções da etapa 1').fill('faça a primeira');
      await editor.getByLabel('Título da etapa 2').fill('Segunda');
      await editor.getByLabel('Instruções da etapa 2').fill('faça a segunda');
      await editor.getByLabel('Modo da etapa 2').selectOption('read');
      assert.equal(await editor.locator('.dep-chip.on').count(), 1, 'second step depends on the first by default');
      await editor.getByRole('button', { name: 'Descer etapa' }).first().click();
      assert.equal(await editor.getByLabel('Título da etapa 1').inputValue(), 'Segunda');
      assert.equal(await editor.locator('.dep-chip.on').count(), 0, 'dependency pointing forward was dropped');
      await editor.getByRole('button', { name: 'Subir etapa' }).nth(1).click();
      await editor.locator('.dep-chip').click();
      assert.equal(await editor.locator('.dep-chip.on').count(), 1);
      await editor.getByRole('button', { name: /Salvar plano/ }).click();
      await page.waitForFunction(() => document.querySelectorAll('.plan-step').length === 2);
      const saved = (await page.evaluate(() => window.vesta.call('bootstrap'))).state.quests[0];
      assert.deepEqual(
        saved.steps.map((s) => s.title),
        ['Primeira', 'Segunda']
      );
      assert.deepEqual(saved.steps[1].dependsOn, [saved.steps[0].id]);
      assert.equal(saved.steps[1].mode, 'read');
      assert.equal(saved.status, 'draft', 'saving never starts the quest');
      await editor.getByRole('button', { name: 'Remover etapa' }).first().click();
      assert.equal(await editor.locator('.plan-step').count(), 1);
      assert.equal(await editor.locator('[data-action=start]').isDisabled(), false);
    });
    await wait(300);
    assert.deepEqual(problems, [], 'renderer reported errors:\n' + problems.join('\n'));
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

(async () => {
  await emptyStorePhase();
  await seededPhase();
  await activityPhase();
  await questPhase();
  console.log('PASS ' + results.length + ' steps, no console errors');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
