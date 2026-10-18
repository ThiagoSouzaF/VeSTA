const { locate, run, command, parser } = require('../electron/providers.cjs');
const fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const ids = process.argv.slice(2);
  const results = [];
  const cwd = require('./test-scratch.cjs')('providers');
  for (const id of ids.length ? ids : ['codex', 'claude', 'opencode']) {
    let chat = { provider: id, mode: 'read', model: id === 'opencode' ? 'drael/drael-v1' : '' };
    try {
      const spec = command(chat, locate(id));
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.CLAUDECODE;
      if (id === 'opencode') env.OPENCODE_PERMISSION = JSON.stringify({ edit: 'deny', bash: 'deny', question: 'deny' });
      const stdout = await run(spec.exe, spec.args, {
        cwd,
        env,
        timeout: 120000,
        input:
          'Teste de integração. Memorize o código ORBITA7429 neste chat. Responda apenas VESTA_OK. Não use ferramentas.',
      });
      const p = parser(id, (e) => {
        if (e.type === 'session') chat.sessionId = e.sessionId;
        if (e.type === 'provider-error') throw new Error(e.message);
      });
      for (const line of stdout.split('\n'))
        if (line.trim())
          try {
            p.accept(JSON.parse(line));
          } catch {}
      if (!p.text.includes('VESTA_OK') || !chat.sessionId)
        throw new Error('Resposta/session inválida: ' + stdout.slice(-1500));
      const resume = command(chat, locate(id));
      const second = await run(resume.exe, resume.args, {
        cwd,
        env,
        timeout: 120000,
        input:
          'Qual foi o código que pedi para memorizar na mensagem anterior? Responda apenas o código, sem ferramentas.',
      });
      const q = parser(id, () => {});
      for (const line of second.split('\n'))
        if (line.trim())
          try {
            q.accept(JSON.parse(line));
          } catch {}
      if (!q.text.includes('ORBITA7429')) throw new Error('A retomada perdeu o contexto: ' + second.slice(-1000));
      results.push({ id, ok: true, reply: p.text, resume: q.text });
      console.log(id + ': PASS — resposta real e retomada com contexto.');
    } catch (e) {
      results.push({ id, ok: false, error: e.message });
      console.log(id + ': FAIL — ' + e.message.slice(0, 1600));
    }
  }
  fs.writeFileSync(path.join(cwd, 'results.json'), JSON.stringify(results, null, 2));
  console.log('Relatório: ' + path.join(cwd, 'results.json'));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
})();
