// E2E: a turn leaves a background command running; VeSTA ends claude.exe. On the next message Claude first
// delivers that stale task as an empty turn (num_turns 0) and only then answers. The answer must reach the chat
// instead of "A IA encerrou sem retornar texto".
// Usage: npx electron scripts/test-claude-stale-task.cjs [model]
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const model = process.argv.slice(2).find((a) => a.startsWith('claude-')) || 'claude-haiku-5-5';
const data = require('./test-scratch.cjs')('claude-stale'),
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
const marker = 'vesta-stale-' + Date.now().toString(36);
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
const turn = async (chatId, text) => {
  const t0 = Date.now();
  await methods.send({ chatId, text });
  while (getState().running.includes(chatId) && Date.now() - t0 < 180000) await delay(250);
  return getState()
    .chats.find((c) => c.id === chatId)
    .messages.at(-1);
};
app.whenReady().then(async () => {
  try {
    await methods.bootstrap();
    const s = await methods.createChat({ provider: 'claude', model, projectId: 'proj', mode: 'edit', memory: false });
    const chat = s.chats[0];
    const first = await turn(
      chat.id,
      'Tarefa de teste. Use a ferramenta Bash com run_in_background=true para rodar exatamente: sleep 600 # ' +
        marker +
        ' . Não espere ele terminar. Responda só INICIADO.'
    );
    assert.equal(first.status, 'done', first.error);
    const second = await turn(
      chat.id,
      'Rode o comando Bash "sleep 12" (em primeiro plano, esperando terminar) e depois responda só com a palavra PERGUNTA-OK.'
    );
    console.log(
      'Segunda resposta:',
      (second.text || second.error || '').trim().slice(0, 120),
      '· status',
      second.status
    );
    assert.equal(second.status, 'done', second.error);
    assert.match(second.text, /PERGUNTA-OK/);
    console.log('PASS: a resposta chega mesmo com a tarefa antiga entregue antes');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    for (const pid of survivors())
      try {
        process.kill(Number(pid));
      } catch {}
    try {
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='sleep.exe'\" | Where-Object { $_.CommandLine -match ' 600' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
      ]);
    } catch {}
    app.quit();
  }
});
