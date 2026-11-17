// E2E: in "ask" mode a real agent (or its subagent) asks before running a command; the answer given in VeSTA
// decides whether it runs. Isolated data dir; answers are clicked programmatically, like the user would.
// Usage: npx electron scripts/test-permissions.cjs <claude|codex|opencode> [allow|deny|subagent|always|stop] [model]
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const provider = process.argv.find((a) => ['claude', 'codex', 'opencode'].includes(a)) || 'claude';
const scenario = process.argv.find((a) => ['allow', 'deny', 'subagent', 'always', 'stop'].includes(a)) || 'allow';
const model =
  process.argv
    .slice(2)
    .find((a) => !a.endsWith('.cjs') && (a.includes('/') || a.startsWith('claude-') || a.startsWith('gpt-'))) ||
  (provider === 'claude' ? 'claude-haiku-5-5' : provider === 'opencode' ? 'drael/drael-v1' : '');
const data = require('./test-scratch.cjs')('permissions'),
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
const ask = (folder) =>
  scenario === 'subagent'
    ? 'Tarefa de teste. ' +
      (provider === 'claude'
        ? 'Use a ferramenta Agent para iniciar um subagente general-purpose'
        : provider === 'codex'
          ? 'Use a ferramenta spawn_agent para iniciar um subagente'
          : 'Use a ferramenta task para iniciar o subagente general') +
      ' cuja única tarefa é criar a pasta "' +
      folder +
      '" no diretório atual com o comando de terminal mkdir. Não crie a pasta você mesmo. No fim responda FEITO ou NEGADO, conforme o resultado.'
    : 'Tarefa de teste. Crie a pasta "' +
      folder +
      '" no diretório atual executando o comando de terminal mkdir ' +
      folder +
      ' . Não use outra forma de criar a pasta. No fim responda FEITO ou NEGADO, conforme o resultado.';
// Waits for the turn to end, answering every permission request with `decision` as it shows up.
async function turn(chatId, text, decision) {
  await methods.send({ chatId, text });
  const answered = new Set(),
    deadline = Date.now() + 300000;
  while (getState().running.includes(chatId) && Date.now() < deadline) {
    const msg = getState()
      .chats.find((c) => c.id === chatId)
      .messages.at(-1);
    for (const p of msg.permissions || [])
      if (p.status === 'pending' && !answered.has(p.id)) {
        answered.add(p.id);
        console.log(
          '  pedido:',
          p.tool,
          '|',
          p.command || p.title,
          p.subagent ? '| subagente: ' + p.subagent : '',
          '->',
          decision
        );
        if (decision === 'stop') methods.stop({ chatId });
        else methods.answerPermission({ id: p.id, decision });
      }
    await delay(200);
  }
  return getState()
    .chats.find((c) => c.id === chatId)
    .messages.at(-1);
}
app.whenReady().then(async () => {
  try {
    await methods.bootstrap();
    const s = await methods.createChat({ provider, model, projectId: 'proj', mode: 'ask', memory: false });
    const chat = s.chats[0];
    const folder = 'vesta-perm-' + scenario;
    if (scenario === 'stop') {
      // Stopping while a request waits: the request is cancelled, the CLI is ended and nothing runs.
      const t0 = Date.now(),
        m = await turn(chat.id, ask(folder), 'stop'),
        took = Date.now() - t0;
      console.log(
        'Pedidos:',
        (m.permissions || []).map((p) => p.status + ' ' + (p.command || p.title)).join(' | '),
        '· status',
        m.status,
        '·',
        Math.round(took / 1000) + 's'
      );
      assert.ok((m.permissions || []).length > 0, 'nenhum pedido chegou');
      assert.equal(m.status, 'cancelled');
      assert.ok(
        m.permissions.every((p) => p.status !== 'pending'),
        'pedido ficou pendente'
      );
      assert.ok(!fs.existsSync(path.join(projectDir, folder)), 'a pasta foi criada mesmo parando');
      assert.ok(!getState().running.includes(chat.id));
      console.log('PASS: ' + provider + ' / stop');
      return;
    }
    const first = await turn(
      chat.id,
      ask(folder),
      scenario === 'deny' ? 'deny' : scenario === 'always' ? 'always' : 'once'
    );
    const perms = first.permissions || [];
    console.log(
      'Pedidos:',
      perms
        .map((p) => p.status + ' ' + (p.command || p.title) + (p.subagent ? ' [' + p.subagent + ']' : ''))
        .join(' | ') || 'nenhum'
    );
    console.log('Resposta:', (first.text || first.error || '').trim().slice(0, 200));
    assert.ok(perms.length > 0, 'nenhum pedido de permissão chegou ao VeSTA');
    assert.equal(first.status, 'done', first.error);
    const exists = fs.existsSync(path.join(projectDir, folder));
    if (scenario === 'deny') {
      assert.ok(
        perms.every((p) => p.status === 'denied'),
        'pedido não ficou como negado'
      );
      assert.ok(!exists, 'a pasta foi criada mesmo negando');
    } else {
      assert.ok(exists, 'a pasta não foi criada depois de permitir');
      assert.ok(perms.some((p) => ['allowed', 'always'].includes(p.status)));
    }
    if (scenario === 'subagent')
      assert.ok(
        perms.some((p) => p.subagent),
        'o pedido não identificou o subagente'
      );
    if (scenario === 'always') {
      // Same program again: the chat rule answers by itself, nobody is asked.
      const second = await turn(chat.id, ask(folder + '-2'), 'deny');
      const p2 = second.permissions || [];
      console.log(
        'Segunda mensagem:',
        p2.map((p) => p.status + ' ' + (p.command || p.title)).join(' | ') || 'sem pedidos'
      );
      assert.ok(
        fs.existsSync(path.join(projectDir, folder + '-2')),
        'a regra "sempre" não deixou o segundo mkdir rodar'
      );
      assert.ok(
        p2.every((p) => p.status !== 'denied'),
        'a regra "sempre" não foi aplicada'
      );
    }
    console.log('PASS: ' + provider + ' / ' + scenario);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
