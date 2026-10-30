// E2E (real AIs, temporary data dir and AI Memory server): a preference said to Claude is learned into the profile and
// followed by ANOTHER AI (Codex) in a brand new conversation; then a subagent question that needs the memory.
//   1. Claude: "prefiro respostas curtas e sempre em português" -> an entry appears in profile/ (Memória > Aprendidas)
//   2. Codex, new chat, question in English -> the profile is in its context and the answer is short and in Portuguese
//   3. Claude delegates to a subagent a question that only the memory can answer -> the context reaches the subagent
// Usage: npx electron scripts/test-memory-prefs-e2e.cjs [claude-model] [only=prefs|subagent]
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const model = process.argv.slice(2).find((a) => a.startsWith('claude-')) || 'claude-haiku-5-5';
const only = (process.argv.slice(2).find((a) => a.startsWith('only=')) || '').slice(5);
const data = require('./test-scratch.cjs')('memprefs'),
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
const chatOf = (id) => getState().chats.find((c) => c.id === id);
const until = async (what, fn, ms = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await delay(500);
  }
  throw new Error('Tempo esgotado: ' + what);
};
const turn = async (chatId, text) => {
  await methods.send({ chatId, text });
  await until('resposta', () => !getState().running.includes(chatId));
  return chatOf(chatId).messages.at(-1);
};
app.whenReady().then(async () => {
  try {
    await methods.bootstrap();
    await methods.refreshConnections();
    if (only !== 'subagent') {
      // ---- 1. Claude learns the preference ----------------------------------------------------------------
      const a = (await methods.createChat({ provider: 'claude', model, projectId: 'proj', mode: 'edit' })).chats[0];
      const m1 = await turn(a.id, 'prefiro respostas curtas e sempre em português.');
      console.log('Claude:', m1.status, JSON.stringify(m1.text.slice(0, 120)));
      assert.equal(m1.status, 'done', m1.error);
      const profile = await until(
        'entrada no perfil',
        async () => {
          const list = await methods.profileList();
          return list.length ? list : null;
        },
        30000
      );
      console.log('Perfil aprendido:', JSON.stringify(profile.map((p) => [p.path, p.statement, p.origin?.provider])));
      assert.match(JSON.stringify(profile), /portugu|curt/i);
      assert.equal(profile[0].origin?.provider, 'claude', 'a origem (IA e conversa) fica registrada');
      // ---- 2. a different AI in a NEW conversation follows it ---------------------------------------------
      const b = (await methods.createChat({ provider: 'codex', projectId: 'proj', mode: 'read' })).chats[0];
      const m2 = await turn(b.id, 'What is the capital of Australia, and why is it not Sydney?');
      console.log('Codex:', m2.status, JSON.stringify(m2.text.slice(0, 300)));
      assert.equal(m2.status, 'done', m2.error);
      assert.match(m2.text, /Canberra/);
      assert.match(m2.text, /\b(é|não|porque|capital|foi|uma)\b/i, 'deveria responder em português');
      assert.doesNotMatch(m2.text, /\b(because|the capital|is not)\b/i, 'não deveria responder em inglês');
      assert.ok(m2.text.length < 700, 'resposta curta: ' + m2.text.length);
      assert.ok(
        m2.activities.some((x) => /Memória compartilhada consultada/.test(x.label)),
        'o perfil entrou no contexto'
      );
      console.log('PASS: a preferência aprendida pelo Claude foi seguida pelo Codex');
    }
    if (only !== 'prefs') {
      // ---- 3. subagent: the memory context reaches it -------------------------------------------------------
      await ctx.memory.ensureProject('proj');
      await ctx.memory.write({
        path: 'agentes/zebra.md',
        title: 'Projeto Zebra',
        kind: 'note',
        projectId: 'proj',
        body: 'O código secreto do projeto Zebra é QUIMERA-4242.',
      });
      const c = (await methods.createChat({ provider: 'claude', model, projectId: 'proj', mode: 'edit' })).chats[0];
      const first = await turn(
        c.id,
        'Use a ferramenta Agent para delegar a um subagente a pergunta "qual é o código secreto do projeto Zebra?" e me diga o que ele respondeu.'
      );
      assert.equal(first.status, 'done', first.error);
      // Claude runs subagents in the background: its answer may come in a follow-up message once the subagent ends.
      await until(
        'subagente e retorno automático',
        () => !getState().running.includes(c.id) && !(getState().following || []).some((f) => f.chatId === c.id),
        300000
      );
      const replies = chatOf(c.id).messages.filter((m) => m.role === 'assistant');
      const sub = replies.flatMap((m) => m.subagents || [])[0];
      const m3 = replies.at(-1);
      console.log('Subagente:', sub ? JSON.stringify((sub.prompt || '').slice(0, 200)) : 'nenhum');
      console.log('Resposta final:', JSON.stringify(m3.text.slice(0, 160)));
      assert.equal(m3.status, 'done', m3.error);
      assert.ok(sub, 'deveria ter delegado a um subagente');
      assert.match(replies.map((m) => m.text).join('\n'), /QUIMERA-4242/);
      const viaPrompt = /QUIMERA-4242/.test(sub.prompt || '');
      const viaMemory = (sub.steps || []).some((s) => /memory|Mem/i.test(s.label || s.detail || ''));
      console.log(
        'contexto chegou ao subagente por:',
        viaPrompt ? 'prompt repassado' : '',
        viaMemory ? 'consulta própria' : ''
      );
      assert.ok(viaPrompt || viaMemory);
      console.log('PASS: o contexto da memória chegou ao subagente');
    }
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
