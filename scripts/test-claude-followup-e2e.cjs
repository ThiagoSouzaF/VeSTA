// E2E (real Claude, cheap model): "acompanhando".
//  1. a background command ends after the turn -> without any user message a NEW assistant message arrives citing its output;
//  2. a user message while following goes to the SAME claude.exe (same process, no second one);
//  3. "Parar de acompanhar" closes claude.exe but the user's background command keeps running.
// Usage: npx electron scripts/test-claude-followup-e2e.cjs [model]
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const model = process.argv.slice(2).find((a) => a.startsWith('claude-')) || 'claude-haiku-5-5';
const data = require('./test-scratch.cjs')('claude-followup'),
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
const { methods, getState, ctx } = require('../electron/main.cjs');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);
const marker1 = 'vesta-fu1-' + stamp,
  marker2 = 'vesta-fu2-' + stamp;
const ps = (filter) => {
  try {
    return execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Where-Object { ' +
          filter +
          ' -and $_.Name -ne "powershell.exe" } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }',
      ],
      { encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
};
const byMarker = (m) => ps("$_.CommandLine -match '" + m + "'");
// Only the claude.exe children of THIS test's Electron process (the user's own Claude sessions are never touched).
const claudeProcs = () => ps("$_.Name -eq 'claude.exe' -and $_.ParentProcessId -eq " + process.pid);
const cleanup = () => {
  for (const line of [...byMarker(marker1), ...byMarker(marker2)])
    try {
      execFileSync('taskkill.exe', ['/F', '/T', '/PID', line.split(' ')[0]], { stdio: 'ignore' });
    } catch {}
};
const chatOf = (id) => getState().chats.find((c) => c.id === id);
const until = async (what, fn, ms = 150000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await delay(250);
  }
  throw new Error('Tempo esgotado: ' + what);
};
app.whenReady().then(async () => {
  try {
    await methods.bootstrap();
    const s = await methods.createChat({ provider: 'claude', model, projectId: 'proj', mode: 'edit', memory: false });
    const chat = s.chats[0];
    // ---- 1. return of a background command without any user message -----------------------------------------
    await methods.send({
      chatId: chat.id,
      text:
        'Tarefa de teste. Use a ferramenta Bash com run_in_background=true para rodar exatamente: sleep 40 && echo PRONTO-123 # ' +
        marker1 +
        ' . Não espere. Responda só "iniciado". Quando o sistema avisar que o comando terminou, leia o arquivo de saída dele e conte aqui o que ele imprimiu.',
    });
    await until('primeira resposta', () => !getState().running.includes(chat.id));
    const first = chatOf(chat.id).messages.at(-1);
    console.log('1a mensagem:', first.status, JSON.stringify(first.text.slice(0, 60)));
    assert.equal(first.status, 'done', first.error);
    await until('modo acompanhando', () => getState().following.some((f) => f.chatId === chat.id), 20000);
    const fol = getState().following.find((f) => f.chatId === chat.id);
    console.log('acompanhando:', fol.tasks.length, 'processo(s)');
    assert.ok(fol.tasks.length >= 1);
    assert.equal(claudeProcs().length >= 1, true, 'claude.exe deveria continuar vivo');
    const t0 = Date.now();
    const auto = await until('retorno automático', () => {
      const ms = chatOf(chat.id).messages;
      const m = ms.find((x) => x.auto === 'background' || x.auto === 'nudge');
      return m && m.status !== 'running' ? m : null;
    });
    console.log(
      'retorno automático após',
      Math.round((Date.now() - t0) / 1000) + 's:',
      auto.status,
      JSON.stringify(auto.text.slice(0, 120))
    );
    assert.equal(auto.status, 'done', auto.error);
    assert.match(auto.text, /PRONTO-123/, 'a nova mensagem deveria citar PRONTO-123');
    assert.ok(!getState().running.includes(chat.id));
    await until(
      'processo encerrado após o retorno',
      () => !getState().following.some((f) => f.chatId === chat.id),
      30000
    );
    // ---- 2 + 3. same process on a user message; stop following keeps the user's command ---------------------
    await methods.send({
      chatId: chat.id,
      text:
        'Use a ferramenta Bash com run_in_background=true para rodar exatamente: sleep 600 # ' +
        marker2 +
        ' . Não espere. Responda só "iniciado2".',
    });
    await until('2o turno', () => !getState().running.includes(chat.id));
    await until('acompanhando de novo', () => getState().following.some((f) => f.chatId === chat.id), 20000);
    const session = ctx.follows.get(chat.id);
    const before = claudeProcs().length;
    await methods.send({ chatId: chat.id, text: 'Responda apenas a palavra OK.' });
    await until('turno no mesmo processo', () => !getState().running.includes(chat.id), 60000);
    const reply = chatOf(chat.id).messages.at(-1);
    assert.match(reply.text, /OK/i);
    assert.equal(claudeProcs().length, before, 'não deveria abrir outro claude.exe');
    await until('segue acompanhando', () => getState().following.some((f) => f.chatId === chat.id), 20000);
    assert.equal(ctx.follows.get(chat.id), session, 'a sessão (processo) deveria ser a mesma');
    console.log('mensagem do usuário foi para o mesmo processo; claude.exe:', before);
    const alive = byMarker(marker2);
    assert.ok(alive.length > 0, 'o comando do usuário deveria estar rodando');
    await methods.stopFollowing({ chatId: chat.id });
    assert.ok(!getState().following.some((f) => f.chatId === chat.id));
    await until('claude.exe encerrado', () => claudeProcs().length === 0, 20000);
    const left = byMarker(marker2);
    console.log(
      'após "Parar de acompanhar": claude.exe',
      claudeProcs().length,
      '· comando do usuário vivo:',
      left.length > 0
    );
    assert.ok(left.length > 0, 'o comando em segundo plano deveria continuar rodando');
    assert.ok(chatOf(chat.id).notice, 'o chat deveria avisar que parou de acompanhar');
    console.log('PASS: retorno automático, mesmo processo e parar de acompanhar');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    cleanup();
    app.quit();
  }
});
