// Screenshots of the real app (throwaway data dir, windows kept off screen): a chat following a background process,
// the automatic return, and the Memória screen with the preferences the AIs learned. Uses real Claude (cheap model).
// Usage: node scripts/shots-follow-memory.cjs <output-dir> [claude-model]
const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const scratch = require('./test-scratch.cjs');
const { mainWindow } = require('./test-windows.cjs');

const out = process.argv[2];
const model = process.argv[3] || 'claude-haiku-5-5';
if (!out) throw new Error('uso: node scripts/shots-follow-memory.cjs <pasta> [modelo]');
fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..');
const data = scratch('shots-m3'),
  projectDir = path.join(data, 'projeto');
fs.mkdirSync(projectDir, { recursive: true });
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 4,
    projects: [{ id: 'proj', name: 'projeto', path: projectDir, createdAt: Date.now() }],
    chats: [],
    memories: [],
  })
);
const marker = 'vesta-shot-' + Date.now().toString(36);
const cleanup = () => {
  try {
    const pids = execFileSync(
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
    for (const pid of pids) execFileSync('taskkill.exe', ['/F', '/T', '/PID', pid], { stdio: 'ignore' });
  } catch {}
};
(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, VESTA_DATA_DIR: data, VESTA_NO_UPDATE: '1', VESTA_NO_USAGE_REFRESH: '1' },
  });
  try {
    const page = await mainWindow(app);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('.app-shell');
    await page.waitForSelector('.loading', { state: 'detached' });
    const call = (m, a) => page.evaluate(([m, a]) => window.vesta.call(m, a), [m, a || {}]);
    const shot = async (name) => {
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, 'm3-' + name + '.png') });
      console.log('shot', name);
    };
    const open = async () => {
      await page.locator('.chat-list-item').first().click();
    };
    // ---- 1. following + automatic return ------------------------------------------------------------------
    let s = await call('createChat', { provider: 'claude', model, projectId: 'proj', mode: 'edit', memory: false });
    const chat = s.chats[0];
    await open();
    await call('send', {
      chatId: chat.id,
      text:
        'Tarefa de teste. Use Bash com run_in_background=true para rodar exatamente: sleep 70 && echo PRONTO-123 # ' +
        marker +
        ' . Não espere. Responda só "iniciado". Quando o sistema avisar que terminou, leia o arquivo de saída e conte aqui o que ele imprimiu.',
    });
    await page.waitForSelector('[data-testid=follow-bar]', { timeout: 120000 });
    await shot('acompanhando');
    await page.locator('.nav-item', { hasText: 'Atividade' }).click();
    await page.waitForSelector('.activity-group');
    await shot('atividade-acompanhando');
    await page.locator('.chat-list-item').first().click();
    await page.waitForSelector('[data-testid=auto-return]', { timeout: 150000 });
    await page.waitForFunction(
      () => !document.querySelector('[data-testid=follow-bar]') && !document.querySelector('.thinking'),
      null,
      { timeout: 60000 }
    );
    await shot('retorno-automatico');
    // ---- 2. preference learned and the Memória screen -----------------------------------------------------
    s = await call('createChat', { provider: 'claude', model, projectId: 'proj', mode: 'edit' });
    const chat2 = s.chats.find((c) => c.id !== chat.id);
    await page.locator('.chat-list-item').first().click();
    await call('send', { chatId: chat2.id, text: 'prefiro respostas curtas e sempre em português.' });
    for (let i = 0; i < 120; i++) {
      const list = await call('profileList').catch(() => []);
      if (list.length) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForFunction(() => !document.querySelector('.thinking'), null, { timeout: 120000 });
    await page.locator('.nav-item', { hasText: 'Memória' }).click();
    await page.locator('.tabs button', { hasText: 'Preferências' }).click();
    await page.waitForSelector('[data-testid=profile-entry]', { timeout: 30000 });
    await shot('memoria-perfil');
    await page.locator('.nav-item', { hasText: 'Preferências' }).click();
    await page.getByText('Processos em segundo plano').first().scrollIntoViewIfNeeded();
    await shot('preferencias-acompanhar');
  } finally {
    await app.close().catch(() => {});
    cleanup();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  cleanup();
  process.exit(1);
});
