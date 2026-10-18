// E2E (real Claude, haiku): two parallel subagents + one short background command. The Activity screen must show
// all three live and mark them done. Uses a throwaway VESTA_DATA_DIR, never the installed app or %APPDATA%\VeSTA.
// Needs a fresh `npm run build`. Usage: node scripts/test-tasks-e2e.cjs [shots-dir] [model]
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');

const root = path.join(__dirname, '..');
const shots = process.argv[2] || path.join(scratch('shots'));
const model = process.argv[3] || 'claude-haiku-5-5';
fs.mkdirSync(shots, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const marker = 'vesta-e2e-' + Date.now().toString(36);
const survivors = () => {
  try {
    return execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '" +
          marker +
          "' -and $_.Name -ne 'powershell.exe' } | ForEach-Object { $_.ProcessId }",
      ],
      { encoding: 'utf8' }
    )
      .split(/\s+/)
      .filter(Boolean);
  } catch {
    return [];
  }
};
const killSurvivors = () => {
  for (const pid of survivors())
    try {
      process.kill(Number(pid));
    } catch {}
};

(async () => {
  const dataDir = scratch('tasks-e2e'),
    projectDir = path.join(dataDir, 'projeto');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'vesta.json'),
    JSON.stringify({
      version: 2,
      settings: { memoryEnabled: false, capture: false, memoryTools: false },
      projects: [{ id: 'proj', name: 'projeto-e2e', path: projectDir, createdAt: Date.now() }],
      chats: [],
      memories: [],
    })
  );
  const env = { ...process.env, VESTA_DATA_DIR: dataDir, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1' };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const problems = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    await page.waitForSelector('.loading', { state: 'detached' });
    await page.setViewportSize({ width: 1280, height: 860 });
    const created = await page.evaluate(
      (m) =>
        window.vesta.call('createChat', {
          provider: 'claude',
          model: m,
          projectId: 'proj',
          mode: 'edit',
          memory: false,
        }),
      model
    );
    const chatId = created.chats[0].id;
    const prompt =
      'Tarefa de teste de painel de atividade. Faça exatamente isto, sem perguntar nada: ' +
      '(1) use a ferramenta Bash com run_in_background=true para rodar: sleep 7 && echo bg-pronto # ' +
      marker +
      ' ; ' +
      '(2) na MESMA mensagem lance dois subagentes com a ferramenta Agent em paralelo (subagent_type general-purpose, model haiku), ' +
      'um chamado "Contagem A" e outro "Contagem B"; cada um deve rodar Bash com: sleep 12 && echo subagente-pronto # ' +
      marker +
      ' e responder em uma linha o que viu. ' +
      '(3) Quando os dois terminarem, responda só FEITO.';
    await page.evaluate(([id, text]) => window.vesta.call('send', { chatId: id, text }), [chatId, prompt]);
    await page.locator('nav .nav-item', { hasText: 'Atividade' }).click();
    await page.locator('h1', { hasText: 'O que está acontecendo.' }).waitFor();

    const sample = () =>
      page.evaluate(() => {
        const n = (k) =>
          Number(document.querySelector('.activity-chip[data-kind="' + k + '"] strong')?.textContent || 0);
        return {
          working: n('working'),
          subagents: n('subagents'),
          commands: n('commands'),
          background: n('background'),
          badge: document.querySelector('nav .count.live')?.textContent || '',
          groups: document.querySelectorAll('.activity-group').length,
        };
      });
    const timeline = [];
    let max = { subagents: 0, background: 0, working: 0, commands: 0 },
      liveShot = false;
    const t0 = Date.now();
    let idle = 0;
    while (Date.now() - t0 < 170000) {
      const s = await sample();
      timeline.push({ t: Math.round((Date.now() - t0) / 1000), ...s });
      for (const k of Object.keys(max)) max[k] = Math.max(max[k], s[k]);
      if (!liveShot && s.subagents >= 2 && s.background >= 1) {
        liveShot = true;
        await page.screenshot({ path: path.join(shots, 'w2-activity-live.png') });
        await page.locator('.activity-group .task-node[data-kind="subagent"] .task-main').first().click();
        await page.screenshot({ path: path.join(shots, 'w2-activity-live-detail.png') });
        await page.locator('.activity-group .task-node[data-kind="subagent"] .task-main').first().click();
      }
      const state = await page.evaluate(() => window.vesta.call('bootstrap').then((b) => b.state.running));
      if (!state.includes(chatId) && max.working > 0) {
        if (++idle >= 3) break;
      } else idle = 0;
      await wait(500);
    }
    await wait(800);
    const final = await sample();
    console.log(
      'timeline (s: working/sub/cmd/bg):',
      timeline
        .filter((_, i) => i % 4 === 0)
        .map((x) => `${x.t}:${x.working}/${x.subagents}/${x.commands}/${x.background}`)
        .join(' ')
    );
    console.log('max simultaneous:', JSON.stringify(max), '· final:', JSON.stringify(final));
    // Final state read from the store (what the screen is derived from).
    const msg = await page.evaluate(
      (id) => window.vesta.call('bootstrap').then((b) => b.state.chats.find((c) => c.id === id).messages.at(-1)),
      chatId
    );
    console.log(
      'mensagem:',
      msg.status,
      '| atividades:',
      (msg.activities || []).map((a) => `${a.kind}${a.background ? '+bg' : ''}:${a.status}`).join(','),
      '| subagentes:',
      (msg.subagents || []).map((s) => `${s.label}:${s.status}(${(s.steps || []).length} etapas)`).join(',')
    );
    await page.getByRole('tab', { name: 'Tudo' }).click();
    await page.screenshot({ path: path.join(shots, 'w2-activity-done.png') });
    await page.locator('.activity-group-title').first().click();
    await page.waitForSelector('.task-summary-line');
    await page.locator('.task-summary-line').first().click();
    await page.screenshot({ path: path.join(shots, 'w2-chat-summary.png') });
    console.log(
      'resumo na mensagem:',
      (await page.locator('.task-summary-line').first().innerText()).replace(/\s+/g, ' ')
    );

    assert.ok(liveShot, 'a tela nunca mostrou 2 subagentes e 1 comando em segundo plano ao mesmo tempo');
    assert.ok(max.subagents >= 2, 'subagentes simultâneos: ' + max.subagents);
    assert.ok(max.background >= 1, 'comandos em segundo plano vistos: ' + max.background);
    assert.equal(msg.status, 'done', msg.error);
    assert.equal((msg.subagents || []).length, 2);
    assert.ok(
      msg.subagents.every((s) => s.status === 'done' && s.endedAt >= s.startedAt),
      'subagentes concluídos'
    );
    const bg = (msg.activities || []).find((a) => a.background);
    assert.ok(bg, 'o Bash em segundo plano virou atividade com background');
    assert.equal(bg.status, 'done', 'o comando em segundo plano terminou durante o turno e foi marcado concluído');
    assert.equal(final.working, 0);
    assert.equal(final.subagents + final.commands + final.background, 0, 'nada ficou "rodando"');
    assert.deepEqual(problems, [], problems.join('\n'));
    console.log('PASS: Atividade mostrou os 3 ao vivo e marcou todos concluídos. Screenshots em ' + shots);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
    try {
      await (await app.firstWindow()).screenshot({ path: path.join(shots, 'w2-fail.png') });
    } catch {}
  } finally {
    await app.close().catch(() => {});
    killSurvivors();
    await wait(500);
    console.log('processos de teste restantes:', survivors().length);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
