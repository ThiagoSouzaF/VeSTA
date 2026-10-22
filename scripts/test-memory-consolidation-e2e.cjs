// E2E (real AIs): a real chat becomes an AI Memory session that the Codex consolidates into rule/gotcha pages.
//   Claude (haiku) answers one message in a project -> the session goes idle (VESTA_MEMORY_IDLE_MS) -> session-end ->
//   memory_consolidate with AI_MEMORY_LLM_PROVIDER=codex -> pages mirrored in the Memória screen and searchable.
// Needs Claude and a logged-in Codex CLI. Uses a throwaway VESTA_DATA_DIR and project, never %APPDATA%\VeSTA.
// Needs a fresh `npm run build`. Usage: node scripts/test-memory-consolidation-e2e.cjs [shots-dir]
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
const RULE =
  'Regra deste projeto, guarde-a: todo TTL no código deve ser em milissegundos e a constante termina com o sufixo _MS (ex.: SESSION_TTL_MS). Motivo: um bug de login expirando cedo porque o TTL estava em segundos. Sem usar ferramentas, responda só: Entendido, TTL em milissegundos com _MS.';

(async () => {
  const dataDir = scratch('mem-e2e'),
    projectDir = path.join(dataDir, 'projeto');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'vesta.json'),
    JSON.stringify({
      version: 3,
      settings: {
        memoryEnabled: true,
        capture: true,
        captureRaw: false,
        memoryConsolidate: 'codex',
        memoryTools: false,
      },
      projects: [{ id: 'proj', name: 'projeto-mem', path: projectDir, createdAt: Date.now() }],
      chats: [],
      memories: [],
      quests: [],
    })
  );
  const env = {
    ...process.env,
    VESTA_DATA_DIR: dataDir,
    VESTA_NO_UPDATE: '1',
    VESTA_NO_USAGE_REFRESH: '1',
    VESTA_MEMORY_IDLE_MS: '4000',
  };
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
    const get = async () => (await call('bootstrap')).state;
    const boot = await call('bootstrap');
    assert.ok(boot.integrations.claude?.installed, 'Claude precisa estar instalado');
    assert.ok(boot.integrations.codex?.installed, 'Codex precisa estar instalado (consolidação)');

    const created = await call('createChat', {
      provider: 'claude',
      model: 'claude-haiku-5-5',
      projectId: 'proj',
      mode: 'read',
    });
    const chatId = created.chats[0].id;
    const t0 = Date.now();
    await call('send', { chatId, text: RULE });
    let chat;
    for (let i = 0; i < 120; i++) {
      chat = (await get()).chats.find((c) => c.id === chatId);
      if (chat.messages.at(-1).status !== 'running') break;
      await wait(1000);
    }
    const reply = chat.messages.at(-1);
    console.log(
      'Claude respondeu:',
      JSON.stringify(reply.text.slice(0, 120)),
      '·',
      Math.round((Date.now() - t0) / 1000) + 's'
    );
    assert.equal(reply.status, 'done', reply.error || 'a resposta não terminou');
    // The turn end is recorded right after the answer: wait for it before checking the session.
    for (let i = 0; i < 20 && !chat.memorySession?.turns; i++) {
      await wait(300);
      chat = (await get()).chats.find((c) => c.id === chatId);
    }
    assert.ok(chat.memorySession?.turns === 1 || !chat.memorySession, 'a conversa abriu uma sessão de memória');

    // Idle -> session-end -> consolidation by the Codex.
    let mem = [];
    const t1 = Date.now();
    for (let i = 0; i < 180; i++) {
      mem = (await get()).memories;
      if (mem.some((m) => m.kind === 'insight')) break;
      await wait(1000);
    }
    const status = await call('memoryStatus');
    console.log('consolidação:', JSON.stringify(status.consolidation), '·', Math.round((Date.now() - t1) / 1000) + 's');
    console.log('páginas:', mem.map((m) => m.path + ' — ' + m.title).join(' | '));
    assert.ok(!status.consolidation.error, 'erro na consolidação: ' + JSON.stringify(status.consolidation.error));
    assert.ok(
      mem.some((m) => m.kind === 'insight'),
      'a consolidação gerou regra/armadilha/aprendizado'
    );
    assert.ok(
      mem.some((m) => m.kind === 'session' && m.path.startsWith('sessions/')),
      'página da sessão'
    );
    assert.ok(
      mem.every((m) => m.projectId === 'proj'),
      'tudo no projeto da conversa'
    );
    assert.ok(!mem.some((m) => m.path.startsWith('conversas/')), 'sem página bruta por resposta');
    assert.equal((await get()).chats.find((c) => c.id === chatId).memorySession, undefined, 'sessão encerrada');
    assert.match(mem.map((m) => m.title + ' ' + m.body).join(' '), /_MS/, 'a regra do _MS foi extraída');

    // Searchable through the AI Memory, as the next conversations will see it.
    const found = String(await call('searchMemory', { query: 'TTL milissegundos', projectId: 'proj' }));
    console.log('busca:', found.replace(/\s+/g, ' ').slice(0, 220));
    assert.match(found, /_MS|milissegundos/i);

    // Memória screen: the Aprendizados tab lists the consolidated pages; Preferências shows the new switches.
    await page.locator('nav .nav-item', { hasText: 'Memória' }).click();
    await page.locator('.memory-toolbar .tabs button', { hasText: 'Aprendizados' }).click();
    await page.locator('.memory-grid .memory-card').first().waitFor();
    await page.screenshot({ path: path.join(shots, 'mem-aprendizados.png') });
    await page.locator('.sidebar-bottom .nav-item').click();
    await page.locator('[aria-label="Consolidar com IA (Codex)"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, 'mem-preferencias.png') });
    assert.deepEqual(problems, [], problems.join('\n'));
    console.log('PASS: conversa real consolidada pelo Codex em páginas do AI Memory. Screenshots em ' + shots);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
    try {
      await page.screenshot({ path: path.join(shots, 'mem-fail.png') });
    } catch {}
  } finally {
    await app.close().catch(() => {});
    await wait(500);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
