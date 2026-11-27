// Equipes: the pure rules (shared/teams.cjs), the engine with a fake AI and a fake git, and the team tools on vesta-skills.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const T = require('../electron/shared/teams.cjs');
const { Store } = require('../electron/app/store.cjs');
const { createTeamEngine } = require('../electron/teams/engine.cjs');
const { createSkillsMcp, TEAM } = require('../electron/mcp/skills.cjs');

const form = (over = {}) => ({
  name: 'Time do site',
  projectId: 'p1',
  goal: 'Página de contato funcionando',
  members: T.TEMPLATES.trio.members,
  ...over,
});

test('normalizeTeam: validation, unique ids, one lead, places, limits', () => {
  assert.throws(() => T.normalizeTeam({ ...form(), name: ' ' }), /nome/);
  assert.throws(() => T.normalizeTeam(form({ members: [T.TEMPLATES.trio.members[0]] })), /dois agents/);
  assert.throws(() => T.normalizeTeam(form({ members: [{ name: 'A' }, { name: 'a' }] })), /nome diferente/);
  const t = T.normalizeTeam(
    form({
      members: [
        { name: 'Você', mode: 'ask' },
        { name: 'Dev', lead: true },
        { name: 'Rev', lead: true },
      ],
    })
  );
  assert.deepEqual(
    t.members.map((m) => m.id),
    ['voce-1', 'dev', 'rev']
  );
  assert.equal(t.members.filter((m) => m.lead).length, 1);
  assert.equal(t.members[0].mode, 'edit', 'no "ask" mode in a team');
  assert.ok(t.members.every((m) => m.x > 0 && m.x < 1 && m.y > 0 && m.y < 1));
  assert.equal(t.maxParallel, 2);
  assert.equal(t.budget, T.DEFAULT_BUDGET);
  assert.equal(T.normalizeTeam(form({ maxTurns: 1 })).maxTurns, 4);
  // Editing keeps what the team did.
  const again = T.normalizeTeam({ ...t, goal: 'Outro' }, { ...t, tasks: [{ id: 'T1' }], status: 'paused' });
  assert.equal(again.tasks.length, 1);
  assert.equal(again.status, 'paused');
});

test('a member on a VPS: its place, action lines instead of tools, offline waits', () => {
  const t = T.normalizeTeam(
    form({
      members: [
        { name: 'Líder', lead: true },
        { name: 'Docs', place: 'vps-1' },
        { name: 'X', place: '../x' },
      ],
    })
  );
  assert.deepEqual(
    t.members.map((m) => m.place),
    ['pc', 'vps-1', 'pc']
  );
  assert.deepEqual(T.placesOf(t), [
    { place: 'pc', count: 2 },
    { place: 'vps-1', count: 1 },
  ]);
  const turn = T.buildTurn(t, t.members[1], { remote: 'vps-hetzner' });
  assert.match(turn, /Você roda em vps-hetzner/);
  assert.match(turn, /vesta_team_send \{"para"/);
  assert.doesNotMatch(turn, /vesta_team_task \{/, 'only the lead creates tasks');
  assert.match(turn, /O quadro agora:\n\{"objetivo"/);
  const text = 'Fiz.\n- vesta_team_send {"para":"Líder","texto":"ok"}\n**vesta_team_task {"x":}**';
  const acts = T.actionsOf(text);
  assert.deepEqual([...acts], [{ tool: 'vesta_team_send', args: { para: 'Líder', texto: 'ok' } }]);
  assert.equal(acts.bad, 1);
  assert.equal(T.proseOf(text), 'Fiz.');
  // Docs has a message but its place is offline: it is not woken.
  t.status = 'running';
  t.messages = [{ id: 'm', at: 5, from: 'lider', to: 'docs', kind: 'task', text: 'README' }];
  assert.deepEqual(
    T.due(t, 10).map((m) => m.id),
    ['docs']
  );
  assert.deepEqual(T.due(t, 10, new Set(['docs'])), []);
});

test('resolve, wires, due and turn text', () => {
  const t = T.normalizeTeam(form());
  t.status = 'running';
  assert.equal(T.resolve(t, 'Você'), T.HUMAN);
  assert.equal(T.resolve(t, 'REVISOR'), 'revisor');
  assert.equal(T.resolve(t, 'ninguém'), null);
  assert.equal(T.wiresOf(t).length, 3, 'you-lead, lead-dev, lead-revisor');
  t.messages = [{ id: 'm', at: 10, from: 'dev', to: 'revisor', kind: 'review', text: 'olha' }];
  assert.equal(T.wiresOf(t).length, 4, 'a pair that talked gets a wire');
  assert.deepEqual(
    T.due(t, 20).map((m) => m.id),
    ['revisor']
  );
  t.members.find((m) => m.id === 'revisor').readAt = 10;
  assert.deepEqual(T.due(t, 20), [], 'seen messages do not wake');
  t.messages.push({ id: 'n', at: 30, from: T.HUMAN, to: 'lider', kind: 'task', text: 'Objetivo' });
  t.messages.push({ id: 'o', at: 31, from: 'lider', to: 'dev', kind: 'task', text: 'T1' });
  t.maxParallel = 1;
  assert.deepEqual(
    T.due(t, 40).map((m) => m.id),
    ['lider'],
    'the lead first, one at a time'
  );
  t.asks = [{ id: 'a', from: 'lider', status: 'open' }];
  assert.deepEqual(
    T.due(t, 40).map((m) => m.id),
    ['dev'],
    'who waits for the person does not wake'
  );
  t.spent = { day: T.dayOf(40), tokens: t.budget };
  assert.deepEqual(T.due(t, 40), [], 'over the budget nobody wakes');
  const text = T.buildTurn(t, T.memberOf(t, 'dev'), { projectName: 'Site', now: 40 });
  assert.match(text, /Você é Dev/);
  assert.match(text, /vesta_team_send/);
  assert.doesNotMatch(text, /vesta_team_task/, 'only the lead creates tasks');
  assert.match(text, /Líder \(tarefa\): T1/);
});

// ---- engine -------------------------------------------------------------------------------------------------------
const dirs = [];
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
function setup({ repo = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-teams-'));
  dirs.push(dir);
  const store = new Store(dir);
  store.state.projects.push({ id: 'p1', name: 'Site', path: dir });
  let t = 1000;
  const sent = [];
  const stopped = [];
  const merged = [];
  const git = {
    isRepo: async () => repo,
    ensureWorktree: async (_p, wd) => fs.mkdirSync(wd, { recursive: true }),
    removeWorktree: async (_p, wd) => fs.rmSync(wd, { recursive: true, force: true }),
    merge: async (_p, _w, branch) => (merged.push(branch), { into: 'main', output: '' }),
    ahead: async () => 2,
  };
  const ctx = { store, sync() {}, stopChat: (id) => stopped.push(id) };
  const engine = createTeamEngine(ctx, {
    now: () => ++t,
    installed: () => true,
    send: async (_ctx, args) => sent.push(args),
    git,
    root: path.join(dir, 'teams'),
    setInterval: () => null,
  });
  ctx.teams = engine;
  const finish = (chatId, text = 'Feito.', tokens = 100, status = 'done') => {
    store.chat(chatId).messages.push({
      role: 'assistant',
      text,
      usage: { inputTokens: tokens, cacheTokens: 0, outputTokens: 0 },
    });
    engine.onChatDone({ chatId, status });
  };
  const flush = () => new Promise((r) => setImmediate(r));
  return { dir, store, engine, sent, stopped, merged, finish, flush, ctx };
}

test('engine: start wakes the lead; tools pass the work; done frees and wakes the next', async () => {
  const { store, engine, sent, finish, flush } = setup();
  const id = engine.create(form());
  await engine.start({ id });
  await flush();
  const team = store.state.teams[0];
  assert.equal(team.status, 'running');
  const dev = T.memberOf(team, 'dev');
  assert.equal(dev.branch, 'equipe/time-do-site/dev', 'editors get a branch');
  assert.equal(T.memberOf(team, 'lider').branch, undefined, 'readers do not');
  assert.equal(sent.length, 1);
  const leadChat = store.chat(sent[0].chatId);
  assert.equal(leadChat.teamId, id);
  assert.match(sent[0].text, /Objetivo: Página de contato/);
  // The lead plans: Dev must wait for a free place (maxParallel 2: lead busy + dev).
  const r = engine.tool(leadChat, 'vesta_team_task', { para: 'Dev', titulo: 'Fazer o formulário' });
  assert.deepEqual(r, { tarefa: 'T1', com: 'Dev' });
  await flush();
  assert.equal(sent.length, 2, 'the task woke Dev');
  const devChat = store.chat(sent[1].chatId);
  assert.equal(devChat.workdir, dev.workdir, 'Dev works in its worktree');
  assert.throws(() => engine.tool(devChat, 'vesta_team_task', { para: 'Revisor', titulo: 'x' }), /Só o líder/);
  assert.throws(() => engine.tool(devChat, 'vesta_team_send', { para: 'Fulano', texto: 'oi' }), /Ninguém/);
  engine.tool(devChat, 'vesta_team_move', { id: 't1', coluna: 'revisao', para: 'Revisor', nota: 'pronto' });
  assert.equal(team.tasks[0].column, 'review');
  // Both are busy: the reviewer waits; when Dev finishes it wakes.
  assert.equal(sent.length, 2);
  finish(devChat.id, 'Formulário pronto.', 300);
  await flush();
  assert.equal(sent.length, 3);
  assert.equal(store.chat(sent[2].chatId).memberId, 'revisor');
  assert.equal(dev.tokens, 300);
  assert.equal(team.spent.tokens, 300);
  assert.equal(dev.lastLine, 'Formulário pronto.');
  // The reviewer may close (or send back) the task it was asked to review; somebody else may not.
  const revChat = store.chat(sent[2].chatId);
  engine.tool(revChat, 'vesta_team_move', { id: 'T1', coluna: 'feito' });
  assert.equal(team.tasks[0].column, 'done');
  assert.throws(() => engine.tool(revChat, 'vesta_team_move', { id: 'T1', coluna: 'a_fazer' }), /quem revisa/);
});

test('engine: asks to the person, answers, pause, stop all, merge, budget and recover', async () => {
  const { store, engine, sent, stopped, merged, finish, flush } = setup();
  const id = engine.create(form());
  await engine.start({ id });
  await flush();
  const team = store.state.teams[0];
  const leadChat = store.chat(sent[0].chatId);
  const r = engine.tool(leadChat, 'vesta_team_send', { para: 'voce', texto: 'Posso juntar?', tipo: 'sim' });
  assert.match(r.entregue, /Você/);
  assert.equal(T.openAsks(team).length, 1);
  assert.equal(team.messages.at(-1).kind, 'human');
  assert.equal(team.asks[0].kind, 'human', 'tipo "sim" asks for a yes');
  finish(leadChat.id);
  await flush();
  assert.equal(sent.length, 1, 'waiting for the person, the lead does not wake again');
  engine.answer({ id, askId: team.asks[0].id, text: 'Pode', decision: 'yes' });
  assert.equal(team.asks[0].decision, 'yes');
  await flush();
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /Você \(resposta\): Pode/);
  assert.throws(() => engine.answer({ id, askId: team.asks[0].id, text: 'De novo' }), /já foi respondida/);
  assert.throws(() => engine.update({ id, ...form({ goal: 'Mudar' }) }), /Espere/);
  engine.stopAll({ id });
  assert.deepEqual(stopped, [leadChat.id]);
  assert.equal(team.status, 'stopped');
  finish(leadChat.id, 'Parei', 10, 'stopped');
  engine.say({ id, to: 'dev', text: 'Faça o formulário' });
  await flush();
  assert.equal(sent.length, 2, 'a stopped team does not wake anybody');
  await engine.merge({ id, memberId: 'dev' });
  assert.deepEqual(merged, ['equipe/time-do-site/dev']);
  await assert.rejects(() => engine.merge({ id, memberId: 'lider' }), /branch própria/);
  // Budget: going over pauses the team.
  team.budget = 50;
  team.status = 'running';
  engine.tick();
  assert.equal(team.status, 'paused');
  assert.match(team.messages.at(-1).text, /teto de tokens/);
  // A restart in the middle of a turn: nobody stays busy, a running team waits for the person.
  team.status = 'running';
  T.memberOf(team, 'dev').busy = true;
  engine.recover();
  assert.equal(team.status, 'paused');
  assert.equal(T.memberOf(team, 'dev').busy, false);
  // Removing gives the chats back to Conversas and removes the agents' folders.
  const devDir = T.memberOf(team, 'dev').workdir;
  await engine.remove({ id });
  assert.equal(store.state.teams.length, 0);
  assert.ok(store.state.chats.every((c) => !c.teamId));
  assert.equal(fs.existsSync(devDir), false);
});

test('engine: without git everybody shares the project folder', async () => {
  const { store, engine, sent, flush } = setup({ repo: false });
  const id = engine.create(form());
  await engine.start({ id });
  await flush();
  const team = store.state.teams[0];
  assert.ok(team.members.every((m) => !m.branch));
  assert.match(team.messages[0].text, /não usa git/);
  assert.equal(store.chat(sent[0].chatId).workdir, undefined);
});

test('vesta-skills MCP: team tools only for team chats, through the engine', async () => {
  const { store, engine, sent, flush, ctx } = setup();
  const id = engine.create(form());
  await engine.start({ id });
  await flush();
  const leadChat = store.chat(sent[0].chatId);
  const plain = { id: 'plain', provider: 'claude', messages: [] };
  store.state.chats.push(plain);
  const host = createSkillsMcp(ctx, { skills: { hasAny: () => true, usable: () => [] }, refiner: () => null });
  try {
    const ep = await host.endpointFor(leadChat);
    const rpc = async (e, method, params) => {
      const r = await fetch(e.mcp, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + e.token,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return (await r.json()).result;
    };
    const names = (await rpc(ep, 'tools/list', {})).tools.map((t) => t.name);
    for (const n of TEAM) assert.ok(names.includes(n), n);
    assert.ok(!names.includes('vesta_refine_propose'));
    const listed = (await rpc(ep, 'tools/list', {})).tools.find((t) => t.name === 'vesta_team_send');
    assert.equal(listed.annotations.readOnlyHint, true, 'works in Só consulta');
    const board = await rpc(ep, 'tools/call', { name: 'vesta_team_board', arguments: {} });
    assert.match(board.content[0].text, /Página de contato/);
    const other = await host.endpointFor(plain);
    const plainNames = (await rpc(other, 'tools/list', {})).tools.map((t) => t.name);
    assert.ok(!plainNames.some((n) => TEAM.includes(n)));
  } finally {
    await host.close();
  }
});

test('team git: a worktree per agent, merge only when clean, a conflict changes nothing', async (t) => {
  const { createTeamGit } = require('../electron/teams/git.cjs');
  const { run } = require('../electron/util/proc.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-teamgit-'));
  dirs.push(dir);
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const g = (cwd, ...args) => run('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
  try {
    await g(repo, 'init', '-q', '-b', 'main');
  } catch {
    return t.skip('git não instalado');
  }
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\n');
  await g(repo, 'add', '.');
  await g(repo, 'commit', '-q', '-m', 'início');
  const git = createTeamGit();
  assert.equal(await git.isRepo(repo), true);
  assert.equal(await git.isRepo(dir), false);
  const wt = path.join(dir, 'teams', 'dev');
  await git.ensureWorktree(repo, wt, 'equipe/x/dev');
  await git.ensureWorktree(repo, wt, 'equipe/x/dev'); // again: reused
  fs.writeFileSync(path.join(wt, 'b.txt'), 'dois\n');
  await assert.rejects(() => git.merge(repo, wt, 'equipe/x/dev'), /pasta do agent/);
  await g(wt, 'add', '.');
  await g(wt, 'commit', '-q', '-m', 'b');
  assert.equal(await git.ahead(repo, 'equipe/x/dev'), 1);
  const r = await git.merge(repo, wt, 'equipe/x/dev');
  assert.equal(r.into, 'main');
  assert.ok(fs.existsSync(path.join(repo, 'b.txt')));
  // Both sides change the same line: aborted, the project stays as it was.
  fs.writeFileSync(path.join(wt, 'a.txt'), 'dev\n');
  await g(wt, 'commit', '-q', '-am', 'dev');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'main\n');
  await g(repo, 'commit', '-q', '-am', 'main');
  await assert.rejects(() => git.merge(repo, wt, 'equipe/x/dev'), /sem conflito/);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8').trim(), 'main');
  assert.equal((await g(repo, 'status', '--porcelain')).trim(), '');
  await git.removeWorktree(repo, wt);
  assert.equal(fs.existsSync(wt), false);
});

test('soul and team context: kept by the form and in every turn of that member', () => {
  const t = T.normalizeTeam(
    form({
      context: '  Go 1.23; nunca mexer em migrations.  ',
      members: [
        { name: 'Líder', lead: true, soul: '# Alma\nCalmo e direto.' },
        { name: 'Dev', soul: 'x'.repeat(T.MAX_SOUL + 50) },
      ],
    })
  );
  assert.equal(t.context, 'Go 1.23; nunca mexer em migrations.');
  assert.equal(t.members[0].soul, '# Alma\nCalmo e direto.', 'line breaks kept');
  assert.equal(t.members[1].soul.length, T.MAX_SOUL);
  const turn = T.buildTurn(t, t.members[0]);
  assert.match(turn, /Contexto da equipe \(vale para todos\):\nGo 1\.23/);
  assert.match(turn, /Quem você é e como trabalha \(siga sempre\):\n# Alma\nCalmo e direto\./);
  assert.doesNotMatch(
    T.buildTurn({ ...t, context: '' }, { ...t.members[0], soul: '' }),
    /Contexto da equipe|Quem você é/
  );
});
