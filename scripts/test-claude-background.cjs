// E2E: Claude starts a background command that never ends (like a dev server). The turn must still finish in
// VeSTA (the chat unlocks), and the background command must keep running afterwards.
// Usage: npx electron scripts/test-claude-background.cjs [model]
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const model = process.argv.slice(2).find((a) => a.startsWith('claude-')) || 'claude-haiku-5-5';
const data = require('./test-scratch.cjs')('claude-bg'),
  projectDir = path.join(data, 'projeto');
fs.mkdirSync(projectDir, { recursive: true });
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 2,
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
const marker = 'vesta-bg-' + Date.now().toString(36);
// Processes whose command line carries the marker (the long-running background command).
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
app.whenReady().then(async () => {
  try {
    await methods.bootstrap();
    const s = await methods.createChat({ provider: 'claude', model, projectId: 'proj', mode: 'edit', memory: false });
    const chat = s.chats[0];
    const t0 = Date.now();
    await methods.send({
      chatId: chat.id,
      text:
        'Tarefa de teste. Use a ferramenta Bash com run_in_background=true para rodar exatamente: sleep 600 # ' +
        marker +
        ' . Não espere ele terminar e não verifique a saída. Responda só INICIADO.',
    });
    while (getState().running.includes(chat.id) && Date.now() - t0 < 180000) await delay(250);
    const took = Math.round((Date.now() - t0) / 1000),
      msg = getState()
        .chats.find((c) => c.id === chat.id)
        .messages.at(-1),
      alive = survivors();
    console.log(
      'Resposta:',
      (msg.text || msg.error || '').trim().slice(0, 120),
      '· status',
      msg.status,
      '·',
      took + 's · comando em segundo plano vivo:',
      alive.length > 0
    );
    assert.ok(!getState().running.includes(chat.id), 'o chat continuou travado');
    assert.equal(msg.status, 'done', msg.error);
    assert.ok(alive.length > 0, 'o comando em segundo plano foi encerrado junto');
    for (const pid of alive)
      try {
        process.kill(Number(pid));
      } catch {}
    console.log('PASS: o turno termina e o comando em segundo plano continua rodando');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
    for (const pid of survivors())
      try {
        process.kill(Number(pid));
      } catch {}
  } finally {
    app.quit();
  }
});
