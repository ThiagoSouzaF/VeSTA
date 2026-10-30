// E2E of the remote control. Run with plain node (it launches the real Electron app through Playwright):
//   npm run build && node scripts/test-remote-e2e.cjs
// Isolated data dir, remote server on localhost with a random port, no network beyond 127.0.0.1, `tailscale serve` is
// never executed. Sends ONE real message to a Claude (haiku) chat through the remote API.
// Env: VESTA_SHOTS = folder for screenshots (default: <tmp>/vesta-shots), VESTA_E2E_NO_AI=1 skips the real message.
// The desktop confirmation dialogs (new device, full access) are answered by VESTA_TEST_AUTO_CONFIRM=1 (accept) or
// =deny (refuse), set below for the launched app only. The packaged app ignores that variable.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  net = require('node:net');
const { _electron: electron, chromium } = require('playwright');
const { WebSocket } = require('ws');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');
const { seedStore } = require('./seed-store.cjs');

const root = path.join(__dirname, '..');
const shots = process.env.VESTA_SHOTS || path.join(os.tmpdir(), 'vesta-shots');
fs.mkdirSync(shots, { recursive: true });
const NO_AI = process.env.VESTA_E2E_NO_AI === '1';
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
const until = async (fn, ms = 15000, what = 'condition') => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {}
    await wait(50);
  }
  throw new Error('timeout waiting for ' + what);
};
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// Playwright's own Chromium when installed; otherwise any Chromium already in the local Playwright cache.
async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (e) {
    const cache =
      process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright');
    const found = fs
      .readdirSync(cache, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^chromium/.test(d.name))
      .map((d) => path.join(cache, d.name))
      .flatMap((dir) =>
        ['chrome-win64/chrome.exe', 'chrome-headless-shell-win64/chrome-headless-shell.exe'].map((f) =>
          path.join(dir, f)
        )
      )
      .filter((f) => fs.existsSync(f));
    if (!found.length) throw e;
    return chromium.launch({ executablePath: found[0] });
  }
}
async function main() {
  if (!fs.existsSync(path.join(root, 'dist-mobile/index.html')) || !fs.existsSync(path.join(root, 'dist/index.html')))
    throw new Error('Run `npm run build` first (dist/ and dist-mobile/).');
  const dataDir = scratch('remote-e2e');
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  seedStore(dataDir, { turns: 12 });
  // Seed: a chat with finished work (Atividade), a paused quest with an errored step, and the remote enabled.
  const file = path.join(dataDir, 'vesta.json');
  const store = JSON.parse(fs.readFileSync(file, 'utf8')),
    now = Date.now();
  // Tinta Mangá is the default theme, so the phone is exercised (and photographed) in it.
  store.version = 4;
  store.settings = { ...store.settings, theme: 'ink', accent: 'ember' };
  store.chats.push({
    id: 'chat-work',
    title: 'Refatorar o módulo de pagamentos',
    provider: 'claude',
    model: 'claude-sonnet-5-5',
    agent: '',
    projectId: null,
    mode: 'ask',
    messages: [
      { id: 'w-u', role: 'user', text: 'Refatore o módulo de pagamentos e rode os testes.', createdAt: now - 60000 },
      {
        id: 'w-a',
        role: 'assistant',
        text: 'Feito. Separei o cálculo de taxas e **todos os testes passam**.',
        createdAt: now - 50000,
        status: 'done',
        provider: 'claude',
        model: 'claude-sonnet-5-5',
        subagents: [],
        activities: [
          { id: 'act1', kind: 'command', label: 'Executou comando', detail: 'npm test', status: 'done' },
          { id: 'act2', kind: 'file', label: 'Editou arquivo', detail: 'src/pagamentos/taxas.js', status: 'done' },
        ],
      },
    ],
    sessionId: 'SESSION-SECRET-ID',
    createdAt: now - 70000,
    updatedAt: now - 40000,
    memory: false,
  });
  store.quests = [
    {
      id: 'quest-1',
      title: 'Migrar autenticação',
      goal: 'Trocar o login por OAuth e atualizar os testes.',
      status: 'paused',
      pauseReason: 'error',
      maxParallel: 2,
      createdAt: now - 90000,
      updatedAt: now - 30000,
      steps: [
        {
          id: 's1',
          title: 'Mapear o login atual',
          provider: 'claude',
          mode: 'read',
          status: 'done',
          result: 'Login em 3 arquivos.',
        },
        {
          id: 's2',
          title: 'Implementar OAuth',
          provider: 'codex',
          mode: 'edit',
          status: 'error',
          dependsOn: ['s1'],
          result: 'Falhou no teste.',
        },
        {
          id: 's3',
          title: 'Atualizar os testes',
          provider: 'claude',
          mode: 'edit',
          status: 'pending',
          dependsOn: ['s2'],
        },
      ],
    },
  ];
  store.memories = [
    { id: 'mem1', path: 'preferences/segredo.md', kind: 'preference', title: 'Segredo', body: 'NAO-VAZAR' },
  ];
  store.remote = { enabled: true, bind: 'localhost', port, devices: [] };
  fs.writeFileSync(file, JSON.stringify(store));

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: {
      ...process.env,
      VESTA_DATA_DIR: dataDir,
      VESTA_NO_UPDATE: '1',
      VESTA_NO_USAGE_REFRESH: '1',
      VESTA_TEST_AUTO_CONFIRM: '1',
    },
  });
  const desktop = await mainWindow(app);
  const problems = [];
  desktop.on('pageerror', (e) => problems.push('desktop pageerror: ' + e.message));
  const browser = await launchChromium();
  try {
    const dcall = (method, args) => desktop.evaluate(([m, a]) => window.vesta.call(m, a), [method, args]);
    const api = async (token, method, args) => {
      const r = await fetch(base + '/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ method, args }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    let token;

    await step('server is up on localhost only, with security headers', async () => {
      await until(async () => (await fetch(base + '/api/health')).ok, 10000, 'remote server');
      const r = await fetch(base + '/');
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      const status = await dcall('remoteStatus');
      assert.equal(status.running, true);
      assert.deepEqual(status.listening, [base]);
      assert.equal(status.devices.length, 0);
    });

    await step('health reveals nothing but ok', async () => {
      assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true });
    });

    await step('without a token: 401, even for forbidden methods', async () => {
      assert.equal((await api(null, 'bootstrap')).status, 401);
      assert.equal((await api(null, 'addProject')).status, 401);
      assert.equal((await api('x'.repeat(43), 'bootstrap')).status, 401);
    });

    let pairing;
    await step('desktop generates a pairing code; phone trades it for a token once', async () => {
      pairing = await dcall('remotePairing');
      assert.equal(pairing.url, base + '/#pair=' + pairing.code);
      assert.ok(pairing.qr.startsWith('data:image/png;base64,'));
      assert.ok(pairing.expiresAt - Date.now() <= 5 * 60 * 1000 && pairing.expiresAt > Date.now());
      const post = (code, name) =>
        fetch(base + '/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, name }),
        });
      const ok = await post(pairing.code, 'Pixel E2E');
      assert.equal(ok.status, 200);
      token = (await ok.json()).token;
      assert.ok(token.length >= 43);
      assert.equal((await post(pairing.code, 'Outro')).status, 401, 'reused code must fail');
      const s = await dcall('remoteStatus');
      assert.deepEqual(
        s.devices.map((d) => d.name),
        ['Pixel E2E']
      );
      assert.ok(!JSON.stringify(s).includes(token), 'token is never listed');
      const saved = fs.readFileSync(file, 'utf8');
      assert.ok(!saved.includes(token), 'token is not stored in clear');
    });

    await step(
      'chats from the phone are born in ask mode; full access goes through the desktop confirmation',
      async () => {
        const ask = await api(token, 'createChat', { provider: 'claude', projectId: null });
        assert.equal(ask.status, 200, JSON.stringify(ask.body));
        assert.equal(ask.body.result.chat.mode, 'ask', 'default mode');
        const drael = await api(token, 'createChat', { provider: 'drael', projectId: null });
        assert.equal(drael.body.result.chat.mode, 'read', 'Drael cannot ask: it reads');
        // auto-confirm accepts in this app; the refusal path runs in the second app at the end
        const edit = await api(token, 'createChat', { provider: 'claude', mode: 'edit', projectId: null });
        assert.equal(edit.status, 200, JSON.stringify(edit.body));
        assert.equal(edit.body.result.chat.mode, 'edit');
        const upd = await api(token, 'updateChat', { id: ask.body.result.chat.id, mode: 'edit' });
        assert.equal(upd.status, 200, JSON.stringify(upd.body));
      }
    );

    await step('authorized bootstrap is sanitized (no memories, session ids or paths)', async () => {
      const r = await api(token, 'bootstrap');
      assert.equal(r.status, 200);
      const text = JSON.stringify(r.body);
      for (const secret of [
        'NAO-VAZAR',
        'SESSION-SECRET-ID',
        'preferences/segredo.md',
        'tokenHash',
        dataDir.replace(/\\/g, '\\\\'),
      ])
        assert.ok(!text.includes(secret), 'leaked: ' + secret);
      assert.ok(r.body.result.state.chats.length >= 3);
      assert.equal(r.body.result.state.memories, undefined);
      assert.equal(r.body.result.dataDir, undefined);
      assert.ok(r.body.result.integrations.claude);
      assert.equal(r.body.result.integrations.claude.exe, undefined);
    });

    await step('forbidden methods answer 403', async () => {
      for (const m of [
        'addProject',
        'openData',
        'openTerminal',
        'openProject',
        'openInstructions',
        'window',
        'saveSettings',
        'deleteChat',
        'deleteMemory',
        'saveMemory',
        'exportChat',
        'checkUpdates',
        'openLink',
        'remotePairing',
        'remoteConfigure',
        'remoteStatus',
        'remoteRevokeDevice',
        'deleteQuest',
        'renameChat',
      ])
        assert.equal((await api(token, m, {})).status, 403, m);
      assert.equal((await api(token, 'send', { chatId: 'chat-short' })).status, 400, 'invalid args');
    });

    await step('useful method errors reach the phone (UserError); unexpected ones stay generic', async () => {
      const missing = await api(token, 'send', { chatId: 'nao-existe', text: 'oi' });
      assert.equal(missing.status, 422);
      assert.equal(missing.body.error, 'Chat não encontrado');
      const busyChat = await api(token, 'stop', { chatId: 'nao-existe' });
      assert.ok(busyChat.status < 500, 'stop of an unknown chat is not a server error: ' + busyChat.status);
    });

    // ---- live stream over the WebSocket + one real message ---------------------------------------------------------
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const frames = [];
    ws.on('message', (m) => frames.push(JSON.parse(m.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'auth', token }));
    await step('WebSocket authenticates with the first message and receives events', async () => {
      await until(() => frames.find((f) => f.t === 'ready'), 5000, 'ready');
      assert.equal((await dcall('remoteStatus')).clients, 1);
    });
    const events = () => frames.filter((f) => f.t === 'events').flatMap((f) => f.events);

    let aiChatId = null;
    if (!NO_AI)
      await step('real Claude (haiku) message through the remote streams over the WebSocket', async () => {
        const created = await api(token, 'createChat', {
          provider: 'claude',
          model: 'claude-haiku-5-5',
          mode: 'read',
          projectId: null,
        });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        aiChatId = created.body.result.chat.id;
        assert.equal(created.body.result.chat.mode, 'read');
        const from = frames.length;
        const sent = await api(token, 'send', {
          chatId: aiChatId,
          text: 'Responda apenas com a palavra OK, sem mais nada.',
        });
        assert.equal(sent.status, 200, JSON.stringify(sent.body));
        await until(() => events().some((e) => e.type === 'chat-done' && e.chatId === aiChatId), 120000, 'chat-done');
        const mine = frames.slice(from).filter((f) => f.t === 'events');
        const text = mine.flatMap((f) => f.events).filter((e) => e.type === 'text' && e.chatId === aiChatId);
        assert.ok(text.length > 0, 'streamed text arrived');
        const streamed = text.map((e) => e.text).join('');
        assert.match(streamed, /OK/i);
        // Final state arrives as an incremental snapshot containing the finished message.
        const snap = mine
          .flatMap((f) => f.events)
          .filter((e) => e.type === 'state')
          .at(-1);
        const chat = snap.chats.find((c) => c.id === aiChatId);
        assert.ok(chat, 'final snapshot carries the chat');
        assert.equal(chat.messages.at(-1).status, 'done');
        assert.match(chat.messages.at(-1).text, /OK/i);
        assert.ok(!JSON.stringify(snap).includes('SESSION-SECRET-ID'));
        console.log(
          '   streamed ' +
            text.length +
            ' text batch(es), ' +
            streamed.length +
            ' chars: ' +
            JSON.stringify(streamed.slice(0, 40))
        );
      });

    // ---- phone UI (Playwright, 390x844) ----------------------------------------------------------------------------
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'pt-BR',
      // The Chromium available here crashes on any service worker; the app must work without one (plain HTTP).
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const uiProblems = [];
    page.on('pageerror', (e) => uiProblems.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && uiProblems.push('console: ' + m.text()));
    const shot = (name) => page.screenshot({ path: path.join(shots, 'w4-' + name + '.png') });

    // The desktop UI path (what the user clicks) produces the code the phone uses.
    await step('desktop Preferências shows the remote section, QR and pairing code', async () => {
      await desktop.setViewportSize({ width: 1440, height: 950 }).catch(() => {});
      await desktop.locator('.sidebar-bottom .nav-item', { hasText: 'Preferências' }).click();
      const section = desktop.locator('[data-section="remote"]');
      await section.waitFor();
      await section.scrollIntoViewIfNeeded();
      await section.getByRole('button', { name: /Parear novo aparelho/ }).click();
      await desktop.getByTestId('pairing').waitFor();
      const qr = desktop.getByAltText('QR code de pareamento');
      await qr.waitFor();
      assert.ok(await qr.evaluate((img) => img.complete && img.naturalWidth > 100), 'QR image rendered');
      pairing = { code: (await desktop.locator('.remote-code').innerText()).trim() };
      assert.ok(pairing.code.length >= 22);
      assert.ok(await section.getByText('Pixel E2E').isVisible(), 'paired device listed');
      await section.scrollIntoViewIfNeeded();
      await wait(300);
      await desktop.screenshot({ path: path.join(shots, 'w4-desktop-prefs-remote.png') });
    });

    await step('phone: pairing screen reads the code from the URL and clears it', async () => {
      await page.goto(base + '/#pair=' + pairing.code);
      await page.waitForSelector('.pair');
      assert.equal(await page.locator('input[aria-label="Código de pareamento"]').inputValue(), pairing.code);
      assert.equal(await page.evaluate(() => location.hash), '', 'code removed from the address bar');
      await shot('mobile-pair');
      await page.getByRole('button', { name: /Parear/ }).click();
      await page.waitForSelector('.chat-list');
      const stored = await page.evaluate(() => localStorage.getItem('vesta.remote.token'));
      assert.ok(stored && stored.length >= 43);
      assert.equal((await dcall('remoteStatus')).devices.length, 2);
    });

    await step('phone: chat list with status, then open a chat with its messages', async () => {
      await page.waitForFunction(() => document.querySelectorAll('.chat-row').length >= 3);
      assert.ok(await page.locator('.chat-row', { hasText: 'Refatorar o módulo de pagamentos' }).isVisible());
      assert.ok(await page.locator('.chat-row', { hasText: 'Conversa longa' }).isVisible());
      await shot('mobile-chats');
      // the header avatar comes from the same pure function as the desktop (src/lib/mascot.js)
      const avatar = page.locator('.topbar.main .mascot.face');
      await avatar.waitFor();
      assert.match(await avatar.getAttribute('class'), /\b(idle|thinking|working|success|error|sleeping)\b/);
      assert.ok(await avatar.locator('img').evaluate((i) => i.complete && i.naturalWidth > 0), 'panel decoded');
      assert.ok(
        (await page.locator('.topbar.main .topbar-title span').innerText()).length > 3,
        'phrase under the title'
      );
      await page.screenshot({
        path: path.join(shots, 'w5-mobile-header.png'),
        clip: { x: 0, y: 0, width: 390, height: 140 },
      });
      await page.locator('.chat-row', { hasText: 'Refatorar o módulo de pagamentos' }).click();
      await page.waitForSelector('.chat-view .msg.assistant');
      assert.ok(await page.getByText('todos os testes passam').isVisible());
      assert.ok(await page.locator('.activity-pill').isVisible());
      await shot('mobile-chat');
    });

    if (!NO_AI)
      await step('phone: the real conversation shows the streamed reply', async () => {
        await page.goBack();
        await page.waitForSelector('.chat-list');
        await page.locator('.chat-row', { hasText: 'Responda apenas' }).click();
        await page.waitForSelector('.chat-view .msg.assistant.done');
        assert.match(await page.locator('.msg.assistant.done').last().innerText(), /OK/i);
        await shot('mobile-chat-real');
        await page.goBack();
      });
    else await page.goBack().catch(() => {});

    await step('phone: creating a chat from the UI opens it (no AI call)', async () => {
      await page.waitForSelector('.chat-list');
      await page.getByRole('button', { name: 'Nova conversa' }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: /Criar conversa/ }).click();
      await page.waitForSelector('.chat-view');
      assert.ok(await page.locator('textarea[aria-label="Mensagem"]').isVisible());
      await page.goBack();
      await page.waitForSelector('.chat-list');
    });

    // Attachments from the phone: upload (authenticated, validated like the desktop), send, thumbnail via attachmentData.
    await step(
      'phone: attaches an image and a document, sends, sees the thumbnail and the card (fake provider)',
      async () => {
        const { makePng, makeTxt } = require('./att-fixtures.cjs');
        const dir = scratch('remote-att');
        const png = await makePng(path.join(dir, 'foto.png')),
          txt = makeTxt(path.join(dir, 'nota.txt'));
        await app.evaluate(() => {
          const main = Object.values(process.mainModule.constructor._cache).find((m) =>
            /electron[\/\\]main.cjs$/.test(m.filename)
          ).exports;
          const drivers = Object.values(process.mainModule.constructor._cache).find((m) =>
            /electron[\/\\]ai[\/\\]drivers.cjs$/.test(m.filename)
          ).exports;
          main.ctx.integrations.claude = { installed: true, exe: 'fake-claude.exe' };
          globalThis.__phoneTurns = [];
          drivers.start = (provider, spec, c) => {
            globalThis.__phoneTurns.push({ prompt: c.prompt, attachments: c.attachments });
            c.parse.accept({ type: 'assistant', message: { content: [{ type: 'text', text: 'Anexos recebidos.' }] } });
            c.parse.accept({ type: 'result', result: 'Anexos recebidos.', num_turns: 1 });
            return { done: Promise.resolve({ code: 0, stderr: '' }), stop() {} };
          };
        });
        const created = await dcall('createChat', { provider: 'claude', memory: false });
        const chatId = created.chats[0].id;
        await page.waitForFunction((id) => document.querySelector('.chat-row'), chatId);
        await page.locator('.chat-row', { hasText: 'Novo chat' }).first().click();
        await page.waitForSelector('.chat-view');
        await page.locator('[data-testid=file-input]').setInputFiles([png, txt]);
        await page.waitForFunction(() => document.querySelectorAll('.m-chip').length === 2);
        assert.equal(await page.locator('.m-chip img').count(), 1, 'the image chip has a preview');
        await shot('mobile-attach-chips');
        await page.getByRole('button', { name: 'Enviar' }).click();
        await page.locator('.msg.user .m-att-thumb img').waitFor();
        await page.locator('.msg.user .m-att-card').waitFor();
        await page.locator('.msg.assistant', { hasText: 'Anexos recebidos.' }).waitFor();
        assert.equal(await page.locator('.m-chip').count(), 0, 'chips are cleared after sending');
        assert.match(await page.locator('.m-att-thumb img').getAttribute('src'), /^data:image\/png;base64,/);
        await shot('mobile-attach-message');
        await page.locator('.m-att-thumb').click();
        await page.locator('.m-viewer img').waitFor();
        await page.locator('.m-viewer-close').click();
        const turn = await app.evaluate(() => globalThis.__phoneTurns[0]);
        assert.equal(turn.attachments.length, 2);
        assert.match(turn.prompt, /nota\.txt/);
        // the phone's view of the chat carries no paths
        const boot = await api(token, 'bootstrap');
        const mine = boot.body.result.state.chats.find((c) => c.id === chatId);
        assert.equal(mine.messages[0].attachments.length, 2);
        assert.equal(JSON.stringify(mine).includes('attachments' + path.sep), false);
        assert.equal('path' in mine.messages[0].attachments[0], false);
        // forbidden: a file the phone never uploaded cannot be attached, nor read through another chat
        const bad = await api(token, 'send', { chatId, text: 'x', attachments: ['ffffffffffff'] });
        assert.equal(bad.status, 422);
        const other = await api(token, 'attachmentData', {
          chatId: 'chat-work',
          id: mine.messages[0].attachments[0].id,
        });
        assert.equal(other.status, 422);
        await page.goBack();
        await page.waitForSelector('.chat-list');
      }
    );

    // Simulated live turn with a pending permission request, as the desktop's own tests do.
    await step(
      'phone: Atividade shows the live turn; the permission request appears and Permitir answers it',
      async () => {
        await app.evaluate(() => {
          const ctx = Object.values(process.mainModule.constructor._cache).find((m) =>
              /electron[\/\\]main.cjs$/.test(m.filename)
            ).exports.ctx,
            chat = ctx.store.chat('chat-work');
          const m = {
            id: 'm-live',
            role: 'assistant',
            text: 'Rodando a suíte de testes…',
            status: 'running',
            provider: 'claude',
            model: 'claude-sonnet-5-5',
            createdAt: Date.now(),
            subagents: [],
            activities: [
              {
                id: 'live1',
                kind: 'command',
                label: 'Executando comando',
                detail: 'npm run test:e2e',
                status: 'running',
              },
            ],
          };
          chat.messages.push(
            { id: 'u-live', role: 'user', text: 'Rode os testes de ponta a ponta.', createdAt: Date.now() },
            m
          );
          ctx.jobs.set(chat.id, { run: null, cancelled: false, assistant: m });
          ctx.sync();
        });
        await page.locator('.tabbar button', { hasText: 'Atividade' }).click();
        await page.waitForSelector('.activity-card.live');
        assert.ok(await page.getByText('npm run test:e2e').first().isVisible());
        await shot('mobile-activity');
        await app.evaluate(() => {
          const ctx = Object.values(process.mainModule.constructor._cache).find((m) =>
            /electron[\/\\]main.cjs$/.test(m.filename)
          ).exports.ctx;
          ctx.permissions.ask('chat-work', {
            provider: 'claude',
            tool: 'Bash',
            title: 'Executar comando no projeto',
            command: 'rm -rf node_modules && npm ci',
          });
        });
        await page.waitForSelector('[data-permission]');
        assert.ok(await page.getByText('rm -rf node_modules && npm ci').isVisible());
        await wait(300);
        await shot('mobile-permission');
        await page.getByRole('button', { name: /Permitir/ }).click();
        await page.waitForSelector('[data-permission]', { state: 'detached' });
        const status = await app.evaluate(() => {
          const ctx = Object.values(process.mainModule.constructor._cache).find((m) =>
              /electron[\/\\]main.cjs$/.test(m.filename)
            ).exports.ctx,
            m = ctx.store.chat('chat-work').messages.find((x) => x.id === 'm-live');
          return m.permissions.map((p) => p.status);
        });
        assert.deepEqual(status, ['allowed']);
        await app.evaluate(() => {
          const ctx = Object.values(process.mainModule.constructor._cache).find((m) =>
              /electron[\/\\]main.cjs$/.test(m.filename)
            ).exports.ctx,
            chat = ctx.store.chat('chat-work'),
            m = chat.messages.find((x) => x.id === 'm-live');
          m.status = 'done';
          m.activities[0].status = 'done';
          ctx.jobs.delete(chat.id);
          ctx.sync();
          ctx.emit({ type: 'chat-done', chatId: chat.id, status: 'done' });
        });
        await page.waitForSelector('.activity-card.live', { state: 'detached' });
      }
    );

    await step('phone: Quests list, detail board and a control (Pular) work', async () => {
      await page.locator('.tabbar button', { hasText: 'Quests' }).click();
      await page.locator('.quest-row', { hasText: 'Migrar autenticação' }).click();
      await page.waitForSelector('.quest-detail [data-step="s2"]');
      assert.equal(await page.locator('[data-column="problems"] [data-step="s2"]').count(), 1);
      await shot('mobile-quest');
      await page.locator('[data-step="s3"]').getByRole('button', { name: /Pular/ }).click();
      await page.waitForFunction(() => document.querySelector('[data-step="s3"]')?.classList.contains('skipped'));
      const q = await app.evaluate(() =>
        Object.values(process.mainModule.constructor._cache)
          .find((m) => /electron[\/\\]main.cjs$/.test(m.filename))
          .exports.ctx.store.state.quests[0].steps.map((s) => s.status)
      );
      assert.deepEqual(q, ['done', 'error', 'skipped']);
      await page.goBack();
    });

    await step('phone: Uso shows the plan windows', async () => {
      await page.locator('.tabbar button', { hasText: 'Uso' }).click();
      await page.waitForSelector('.usage-card');
      assert.ok(await page.getByText('Janela de 5 horas').first().isVisible());
      await shot('mobile-usage');
    });

    await step(
      'phone: installable (manifest + service worker), no horizontal overflow, no console errors',
      async () => {
        const manifest = await (await fetch(base + '/manifest.webmanifest')).json();
        assert.equal(manifest.display, 'standalone');
        assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
        assert.equal((await fetch(base + '/icon-512.png')).status, 200);
        const sw = await fetch(base + '/sw.js');
        assert.equal(sw.status, 200);
        const swText = await sw.text();
        assert.ok(swText.includes('/api/') && !swText.includes('__FILES__') && !swText.includes('__VERSION__'));
        const files = JSON.parse(swText.split('const FILES = ')[1].split(';\n')[0]);
        assert.ok(files.length > 8 && files.includes('./index.html'));
        for (const f of files) assert.equal((await fetch(new URL(f, base + '/'))).status, 200, 'precached ' + f);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 0, 'horizontal overflow: ' + overflow);
        assert.deepEqual(uiProblems, []);
      }
    );

    await step('revoking the device on the desktop closes its socket and blocks it', async () => {
      const devices = (await dcall('remoteStatus')).devices;
      const mine = devices.find((d) => d.name === 'Pixel E2E');
      const closed = new Promise((r) => ws.once('close', (code) => r(code)));
      await dcall('remoteRevokeDevice', { id: mine.id });
      assert.equal(await closed, 4403);
      assert.equal((await api(token, 'bootstrap')).status, 401);
      // the phone that paired through the QR is still fine until revoked too
      const other = devices.find((d) => d.name !== 'Pixel E2E');
      await dcall('remoteRevokeDevice', { id: other.id });
      await page.reload();
      await page.waitForSelector('.pair');
    });

    // Second app instance: its dialogs are refused. Also proves a saved LAN config is migrated to "off" with a warning.
    await step(
      'refused on the desktop: no token is issued; saved LAN config is migrated off with a warning',
      async () => {
        const dir2 = scratch('remote-e2e-deny'),
          port2 = await freePort(),
          base2 = 'http://127.0.0.1:' + port2;
        seedStore(dir2, { turns: 1 });
        const file2 = path.join(dir2, 'vesta.json');
        const store2 = JSON.parse(fs.readFileSync(file2, 'utf8'));
        store2.remote = { enabled: true, bind: 'lan', port: port2, devices: [] };
        fs.writeFileSync(file2, JSON.stringify(store2));
        const app2 = await electron.launch({
          executablePath: require('electron'),
          args: [root],
          env: {
            ...process.env,
            VESTA_DATA_DIR: dir2,
            VESTA_NO_UPDATE: '1',
            VESTA_NO_USAGE_REFRESH: '1',
            VESTA_TEST_AUTO_CONFIRM: 'deny',
          },
        });
        try {
          const win2 = await mainWindow(app2);
          const call2 = (method, args) => win2.evaluate(([m, a]) => window.vesta.call(m, a), [method, args]);
          let st = await call2('remoteStatus');
          assert.equal(st.enabled, false);
          assert.equal(st.running, false);
          assert.match(st.notice, /Rede local \(LAN\)/);
          await assert.rejects(call2('remoteConfigure', { bind: 'lan' }), /Interface inválida/);
          st = await call2('remoteConfigure', { bind: 'localhost', enabled: true });
          assert.equal(st.running, true);
          assert.equal(st.notice, '');
          const { code } = await call2('remotePairing');
          const pair = (c) =>
            fetch(base2 + '/api/pair', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: c, name: 'Intruso' }),
            });
          const refused = await pair(code);
          assert.equal(refused.status, 403);
          assert.match((await refused.json()).error, /recusado no desktop/);
          assert.equal((await call2('remoteStatus')).devices.length, 0);
          assert.equal((await pair(code)).status, 401, 'the code was spent by the refused attempt');
        } finally {
          await app2.close().catch(() => {});
        }
      }
    );

    await step('desktop shows no page errors', async () => {
      assert.deepEqual(problems, []);
    });
  } finally {
    await browser.close().catch(() => {});
    await app.close().catch(() => {});
  }
  console.log('\n' + results.length + ' steps passed. Screenshots: ' + shots);
}
main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
