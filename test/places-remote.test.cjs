// Onde rodam, fase 2: a VPS reached by SSH. The systemd timer of an agent, the ssh command (quoting, what is refused),
// the probe of the machine, and the places engine against a fake VPS: a fake `sh` that runs the real runner with node
// in a temp folder (what `ssh host sh -lc '…'` would run there), so the JSON that crosses is the real one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawnSync } = require('node:child_process');
const { unitFiles, timerLines, createScheduler } = require('../electron/runner/scheduler.cjs');
const { createRunner } = require('../electron/runner/vesta-agent.cjs');
const { runnerHash } = require('../electron/runner/files.cjs');
const { createSsh, checkTarget, q, PROBE, readProbe, sshLine } = require('../electron/places/ssh.cjs');
const { connectPlan } = require('../electron/shared/places.cjs');
const { Store } = require('../electron/app/store.cjs');
const { createAgentEngine } = require('../electron/agents/engine.cjs');
const { createPlaces } = require('../electron/places/engine.cjs');
const { createTeamEngine } = require('../electron/teams/engine.cjs');
const T = require('../electron/shared/teams.cjs');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-remote-' + name + '-'));

test('systemd: each schedule as a timer, the command quoted for ExecStart, catch-up as Persistent', () => {
  assert.deepEqual(timerLines({ kind: 'daily', time: '8:05' }), ['OnCalendar=*-*-* 08:05:00', 'Persistent=true']);
  assert.deepEqual(timerLines({ kind: 'weekdays', time: '23:50' }, false), [
    'OnCalendar=Mon..Fri *-*-* 23:50:00',
    'Persistent=false',
  ]);
  assert.equal(timerLines({ kind: 'weekly', time: '07:00', days: [1, 3] })[0], 'OnCalendar=Mon,Wed *-*-* 07:00:00');
  assert.deepEqual(timerLines({ kind: 'interval', hours: 2 }), ['OnActiveSec=2h', 'OnUnitActiveSec=2h']);
  assert.equal(timerLines({ kind: 'manual' }), null);
  assert.equal(timerLines({ kind: 'weekly', days: [] }), null);
  const u = unitFiles({
    name: 'Bom dia 100%\nnova linha',
    schedule: { kind: 'daily', time: '08:30' },
    command: '/usr/bin/node',
    args: ['/home/thiago/.vesta-agents/runner/vesta-agent.cjs', 'run', 'bom-dia', '--home', '/home/thiago/a "b"'],
  });
  assert.match(u.service, /^Description=Agent do VeSTA: Bom dia 100%% nova linha$/m);
  assert.match(
    u.service,
    /^ExecStart="\/usr\/bin\/node" "\/home\/thiago\/\.vesta-agents\/runner\/vesta-agent\.cjs" "run" "bom-dia" "--home" "\/home\/thiago\/a \\"b\\""$/m
  );
  assert.match(u.service, /^Type=oneshot$/m);
  assert.match(u.timer, /^WantedBy=timers\.target$/m);
  assert.equal(unitFiles({ name: 'x', schedule: { kind: 'manual' }, command: 'node' }), null);
});

test('systemd scheduler: writes the units, reloads and starts the timer; removing undoes it', async () => {
  const dir = tmp('units');
  const calls = [];
  const s = createScheduler({ kind: 'systemd', dir, run: async (file, args) => calls.push([file, ...args]) });
  assert.equal(s.taskName('bom-dia'), 'vesta-agent-bom-dia.timer');
  const job = { name: 'Bom dia', schedule: { kind: 'daily', time: '08:30' }, command: 'node', args: ['r.cjs'] };
  assert.equal(await s.register('bom-dia', job), true);
  assert.ok(fs.existsSync(path.join(dir, 'vesta-agent-bom-dia.service')));
  assert.equal(await s.exists('bom-dia'), true);
  assert.deepEqual(calls, [
    ['systemctl', '--user', 'daemon-reload'],
    ['systemctl', '--user', 'enable', 'vesta-agent-bom-dia.timer'],
    ['systemctl', '--user', 'restart', 'vesta-agent-bom-dia.timer'],
  ]);
  calls.length = 0;
  // A schedule that only runs on request takes the timer away.
  assert.equal(await s.register('bom-dia', { ...job, schedule: { kind: 'manual' } }), false);
  assert.deepEqual(calls[0], ['systemctl', '--user', 'disable', '--now', 'vesta-agent-bom-dia.timer']);
  assert.equal(fs.existsSync(path.join(dir, 'vesta-agent-bom-dia.timer')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ssh: only a real address, the keys of the person (no password prompt), one quoted login-shell command', async () => {
  for (const bad of ['-oProxyCommand=calc', 'a b@host', 'thiago@host;rm', '', 'host:22'])
    assert.throws(() => checkTarget({ host: bad }), /Endereço inválido/, bad);
  assert.throws(() => checkTarget({ host: 'vps', port: 70000 }), /Porta inválida/);
  assert.deepEqual(checkTarget({ host: ' thiago@203.0.113.10 ', port: '2222' }), {
    host: 'thiago@203.0.113.10',
    port: 2222,
  });
  assert.equal(checkTarget({ host: 'meu-vps' }).port, 22, 'an alias of ~/.ssh/config');
  assert.equal(q("it's"), "'it'\\''s'");
  assert.equal(sshLine({ host: 'vps', port: 22 }), 'ssh vps');
  assert.equal(sshLine({ host: 'vps', port: 2222 }), 'ssh -p 2222 vps');
  let seen;
  const sh = createSsh({
    program: { exe: 'ssh.exe', args: [] },
    spawn: (exe, args) => {
      seen = { exe, args };
      const { EventEmitter } = require('node:events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        on() {},
        end: () => setImmediate(() => (child.stdout.emit('data', 'oi'), child.emit('close', 0))),
      };
      return child;
    },
  });
  const r = await sh({ host: 'thiago@vps', port: 2222 }, "echo 'a b'");
  assert.deepEqual(r, { code: 0, out: 'oi', err: '' });
  assert.ok(seen.args.includes('BatchMode=yes'));
  assert.ok(seen.args.includes('StrictHostKeyChecking=accept-new'));
  assert.deepEqual(seen.args.slice(-4), ['-p', '2222', 'thiago@vps', "sh -lc 'echo '\\''a b'\\'''"]);
});

test('probe: the machine as a place, and why it cannot be one', () => {
  const ok = readProbe(
    [
      'home=/home/thiago',
      'user=thiago',
      'uname=Linux x86_64',
      'distro=Ubuntu 24.04.1 LTS',
      'node=/usr/bin/node',
      'nodever=v22.11.0',
      'path=/usr/local/bin:/usr/bin',
      'ai.claude=/usr/local/bin/claude',
      'ai.codex=',
      'ai.opencode=',
      'systemd=1',
      'linger=no',
    ].join('\n')
  );
  assert.equal(ok.problem, '');
  assert.equal(ok.kind, 'Ubuntu 24.04.1 LTS · systemd');
  assert.deepEqual(ok.ais, { claude: { exe: '/usr/local/bin/claude' } });
  assert.equal(ok.linger, false);
  assert.equal(
    readProbe('home=/root\nnode=/usr/bin/node\nnodever=v16.20.0').problem,
    'Node v16.20.0 é antigo: precisa do 18 ou mais'
  );
  assert.match(readProbe('home=/root\nnode=').problem, /Node não encontrado/);
  const none = readProbe('home=/root\nnode=/n\nnodever=v20.1.0\nuname=Linux aarch64');
  assert.equal(none.scheduler, 'none');
  assert.equal(none.linger, null);
  assert.equal(connectPlan({ host: 'pi@raspberrypi.local' })[3][1], 'loginctl enable-linger pi');
});

// ---- The engine against a fake VPS ---------------------------------------------------------------------------------
// The words of a command line built with q(): 'quoted' or bare.
function words(line) {
  const out = [];
  const re = /'((?:[^']|'\\'')*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2]);
  return out;
}
function fakeVps(root) {
  const vps = { calls: [], down: false, root };
  const probe = [
    'home=' + root,
    'user=thiago',
    'uname=Linux x86_64',
    'distro=Ubuntu 24.04 LTS',
    'node=' + process.execPath,
    'nodever=' + process.version,
    'path=/usr/bin',
    'ai.claude=' + process.execPath,
    'systemd=1',
    'linger=no',
  ].join('\n');
  vps.sh = async (target, script, { stdin = '' } = {}) => {
    vps.calls.push(script);
    if (vps.down) return { code: 255, out: '', err: 'ssh: connect to host vps port 22: Connection timed out' };
    if (script === PROBE) return { code: 0, out: probe, err: '' };
    if (script.startsWith('loginctl')) return { code: 1, out: '', err: 'Interactive authentication required.' };
    const line = script.replace(/^nohup /, '').replace(/ <\/dev\/null.*$/, '');
    const [exe, ...args] = words(line);
    // The VPS has no systemd here: the runner's own switch keeps the timers out of this test machine.
    const r = spawnSync(exe, args, {
      input: stdin,
      encoding: 'utf8',
      env: { ...process.env, VESTA_AGENT_SCHEDULER: 'none' },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  return vps;
}
function setup() {
  const dir = tmp('engine');
  const store = new Store(path.join(dir, 'vesta.json'));
  const vps = fakeVps(path.join(dir, 'vps-home'));
  fs.mkdirSync(vps.root);
  let clock = Date.now();
  const ctx = { store, sync() {}, integrations: {}, skills: { inline: () => null } };
  ctx.agents = createAgentEngine(ctx, { send: async () => {}, installed: () => true });
  ctx.places = createPlaces(ctx, {
    home: path.join(dir, 'pc-agents'),
    sh: vps.sh,
    version: '0.34.0',
    now: () => clock,
  });
  store.state.projects.push({ id: 'p1', name: 'Mora', path: dir });
  const id = ctx.agents.create({
    name: 'Testes de toda noite',
    prompt: 'Rode os testes.',
    provider: 'claude',
    mode: 'read',
    projectId: 'p1',
    schedule: { kind: 'daily', time: '23:50' },
  });
  const a = () => store.state.agents.find((x) => x.id === id);
  return { dir, ctx, vps, id, a, tick: (ms) => (clock += ms) };
}

test('vps: connecting copies the runner by SSH, writes its config and says each step', async () => {
  const { dir, ctx, vps } = setup();
  const r = await ctx.places.connect({ name: 'vps-hetzner', host: 'thiago@203.0.113.10' });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.steps.map((s) => [s.label, s.status]),
    [
      ['Conectar', 'ok'],
      ['Node 18 ou mais', 'ok'],
      ['Instalar o executor na pasta padrão', 'ok'],
      ['Agendador sem login aberto', 'warn'],
      ['Procurar as IAs', 'ok'],
    ]
  );
  assert.match(r.steps[3].detail, /sudo loginctl enable-linger thiago/);
  const home = path.posix.join(vps.root, '.vesta-agents');
  const runnerDir = path.join(home, 'runner');
  assert.ok(fs.existsSync(path.join(runnerDir, 'vesta-agent.cjs')));
  assert.match(fs.readFileSync(path.join(runnerDir, 'vesta-agent'), 'utf8'), /^#!\/bin\/sh/);
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(config.scheduler, 'systemd');
  assert.equal(config.path, '/usr/bin');
  assert.deepEqual(config.launcher.args, [path.posix.join(home, 'runner', 'vesta-agent.cjs')]);
  const place = ctx.store.state.places[0];
  assert.equal(place.name, 'vps-hetzner');
  assert.equal(place.runner.hash, runnerHash());
  const view = ctx.places.view().places[1];
  assert.equal(view.kind, 'Ubuntu 24.04 LTS · systemd');
  assert.equal(view.online, true);
  assert.equal(view.ais.claude.installed, true);
  assert.equal(view.ais.drael.installed, false);
  assert.ok(view.commands.includes("systemctl --user list-timers 'vesta-agent-*'"));
  // The same address again is the same place.
  await ctx.places.connect({ name: 'outro nome', host: 'thiago@203.0.113.10' });
  assert.equal(ctx.store.state.places.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('vps: a machine without Node or unreachable is not kept, and the step says why', async () => {
  const { dir, ctx, vps } = setup();
  vps.down = true;
  const r = await ctx.places.connect({ host: 'thiago@203.0.113.10' });
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.steps.map((s) => s.status),
    ['error']
  );
  assert.match(r.steps[0].detail, /Connection timed out/);
  assert.equal(ctx.store.state.places.length, 0);
  await assert.rejects(ctx.places.connect({ host: '-oProxyCommand=calc' }), /Endereço inválido/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('vps: install there, run there, the run comes back; offline keeps the last list; forget cleans up', async () => {
  const { dir, ctx, vps, id, a, tick } = setup();
  const { placeId } = await ctx.places.connect({ name: 'vps-hetzner', host: 'thiago@203.0.113.10' });
  assert.equal(ctx.places.packageOf(a(), placeId).cwd, null, 'the project folder is on the PC, not on the VPS');
  assert.equal(ctx.places.packageOf(a(), 'pc').cwd, dir);
  const { results } = await ctx.places.install({ placeId, agentIds: [id] });
  assert.equal(results[0].slug, 'testes-de-toda-noite');
  assert.equal(a().places[placeId].slug, 'testes-de-toda-noite');
  let vpsView = ctx.places.view().places[1];
  assert.equal(vpsView.agents[0].agentId, id, 'the list read after installing');
  // The real AI there is the fake Claude of this test.
  const home = path.posix.join(vps.root, '.vesta-agents');
  const fake = path.join(dir, 'fake-claude.cjs');
  fs.writeFileSync(
    fake,
    "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'result',result:'Resumo: 14 testes passaram.\\nLição: rode o build antes.',usage:{input_tokens:1,output_tokens:1}})))"
  );
  createRunner({ home }).setConfig({ ais: { claude: { exe: process.execPath, args: [fake] } } });
  // "Rodar agora" (also from the card) goes to the VPS.
  const started = await ctx.agents.runNow({ id });
  assert.equal(started.placeId, placeId);
  assert.ok(vps.calls.some((c) => c.startsWith('nohup ')));
  assert.ok(a().places[placeId].running);
  tick(25000);
  assert.equal(await ctx.places.syncRemotes(), true, 'read again soon while one of its agents runs');
  assert.equal(a().runs[0].place, placeId);
  assert.equal(a().runs[0].summary, '14 testes passaram.');
  assert.equal(a().places[placeId].running, null);
  assert.deepEqual(
    a().lessons.map((l) => [l.text, l.status]),
    [['rode o build antes.', 'pending']]
  );
  // Offline: the last list stays, marked.
  vps.down = true;
  tick(10 * 60000);
  await ctx.places.syncRemotes();
  vpsView = ctx.places.view().places[1];
  assert.equal(vpsView.online, false);
  assert.match(vpsView.error, /Connection timed out/);
  assert.equal(vpsView.agents.length, 1);
  await assert.rejects(ctx.places.runNow({ agentId: id }), /Sem conexão com vps-hetzner/);
  // Back: forgetting the place takes its agents out of the VPS and the agent runs with VeSTA open again.
  vps.down = false;
  const { left } = await ctx.places.forgetPlace({ placeId });
  assert.equal(left, 0);
  assert.deepEqual(a().places, {});
  assert.equal(ctx.store.state.places.length, 0);
  assert.equal(fs.existsSync(path.join(home, 'agents', 'testes-de-toda-noite')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A fake AI on the VPS: answers with what the test says and keeps what it got (the prompt, the folder).
function fakeAi(dir, reply) {
  const file = path.join(dir, 'fake-ai.cjs');
  fs.writeFileSync(
    file,
    `let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'ai-seen.json'))}, JSON.stringify({ cwd: process.cwd(), input }));
  console.log(JSON.stringify({ type: 'result', result: ${JSON.stringify(reply)}, usage: { input_tokens: 40, output_tokens: 2 } }));
});`
  );
  return { exe: process.execPath, args: [file] };
}
const until = async (fn, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100)))
    if (await fn()) return;
  throw new Error('não aconteceu a tempo');
};

test('vps: changes go by themselves; an offline VPS gets them when it is back', async () => {
  const { dir, ctx, vps, id, a, tick } = setup();
  const { placeId } = await ctx.places.connect({ name: 'vps-hetzner', host: 'thiago@203.0.113.10' });
  await ctx.places.install({ placeId, agentIds: [id] });
  vps.down = true;
  tick(10 * 60000);
  await ctx.places.syncRemotes();
  ctx.agents.update({ id, ...a(), prompt: 'Rode os testes e o build.' });
  tick(10 * 60000);
  await ctx.places.syncRemotes();
  assert.equal(ctx.places.view().places[1].agents[0].outdated, true, 'waits while offline');
  vps.down = false;
  tick(10 * 60000);
  await ctx.places.syncRemotes();
  const there = path.posix.join(vps.root, '.vesta-agents', 'agents', 'testes-de-toda-noite', 'agent.json');
  assert.match(fs.readFileSync(there, 'utf8'), /e o build/);
  assert.equal(ctx.places.view().places[1].agents[0].outdated, false);
  assert.equal(a().places[placeId].outdated, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('vps team member: its turn runs there, its action lines reach the board, offline holds its messages', async () => {
  const { dir, ctx, vps, tick } = setup();
  const { placeId } = await ctx.places.connect({ name: 'vps-hetzner', host: 'thiago@203.0.113.10' });
  const home = path.posix.join(vps.root, '.vesta-agents');
  createRunner({ home }).setConfig({
    ais: {
      claude: fakeAi(
        dir,
        'Escrevi o README.\nvesta_team_send {"para":"Líder","tipo":"resposta","texto":"README pronto"}\n`vesta_team_move {"id":"T9","coluna":"feito"}`\nvesta_team_send {quebrado}'
      ),
    },
  });
  const sent = [];
  const teams = createTeamEngine(ctx, {
    installed: () => true,
    send: async (_c, args) => sent.push(args),
    git: { isRepo: async () => false },
    root: path.join(dir, 'teams'),
    setInterval: () => null,
  });
  ctx.teams = teams;
  const teamId = teams.create({
    name: 'Equipe do site',
    projectId: 'p1',
    goal: 'README novo',
    members: [
      { name: 'Líder', provider: 'claude', mode: 'read', lead: true },
      { name: 'Docs', provider: 'claude', mode: 'edit', place: placeId },
    ],
  });
  const team = ctx.store.state.teams[0];
  const docs = T.memberOf(team, 'docs');
  assert.equal(docs.place, placeId);
  // A runner from an older VeSTA there does not know the team jobs.
  const vpsPlace = ctx.store.state.places[0];
  const hash = vpsPlace.runner.hash;
  vpsPlace.runner.hash = 'antigo';
  await assert.rejects(teams.start({ id: teamId }), /Atualize o executor de vps-hetzner/);
  vpsPlace.runner.hash = hash;
  // Drael never runs on a VPS.
  teams.update({ id: teamId, members: team.members.map((m) => (m.id === 'docs' ? { ...m, provider: 'drael' } : m)) });
  await assert.rejects(teams.start({ id: teamId }), /Docs \(vps-hetzner\): a IA não está instalada lá/);
  teams.update({ id: teamId, members: team.members.map((m) => ({ ...m, provider: 'claude' })) });
  const t = () => ctx.store.state.teams[0];
  const m = () => T.memberOf(t(), 'docs');
  await teams.start({ id: teamId });
  await new Promise((r) => setImmediate(r));
  const leadChat = ctx.store.chat(sent[0].chatId);
  teams.tool(leadChat, 'vesta_team_send', { para: 'Docs', texto: 'Escreva o README.' });
  await until(() => m().job && vps.calls.some((c) => c.includes("'job' '-'")));
  assert.equal(m().busy, true);
  assert.equal(m().chatId, undefined, 'no chat for a member on a VPS');
  // The job runs there apart from the SSH call; the next read brings it back.
  await until(async () => (await ctx.places.jobs(placeId)).some((j) => j.state === 'done'));
  const seenThere = JSON.parse(fs.readFileSync(path.join(dir, 'ai-seen.json'), 'utf8'));
  assert.match(seenThere.input, /Você roda em vps-hetzner/);
  assert.match(seenThere.input, /Escreva o README\./);
  assert.match(seenThere.input, /O quadro agora:/);
  assert.equal(path.resolve(seenThere.cwd), path.resolve(home, 'teams', teamId, 'docs'));
  await teams.collect();
  assert.equal(m().busy, false);
  assert.equal(m().lastLine, 'Escrevi o README.');
  assert.equal(m().tokens, 42);
  const said = t().messages.filter((x) => x.from === 'docs');
  assert.deepEqual(
    said.map((x) => [x.to, x.kind, x.text]),
    [['lider', 'answer', 'README pronto']]
  );
  assert.ok(t().messages.some((x) => /move recusado \(Tarefa não encontrada: T9/.test(x.text)));
  assert.ok(t().messages.some((x) => /1 linha\(s\) de ação sem JSON válido/.test(x.text)));
  await until(async () => !(await ctx.places.jobs(placeId)).length);
  // Offline: what goes to Docs waits, marked; when the VPS is back, Docs wakes with it.
  vps.down = true;
  tick(10 * 60000);
  await ctx.places.syncRemotes();
  const calls = vps.calls.length;
  teams.tool(leadChat, 'vesta_team_send', { para: 'Docs', texto: 'Agora o CHANGELOG.' });
  const held = t().messages.at(-1);
  assert.equal(held.held, true);
  assert.equal(m().busy, false);
  vps.down = false;
  tick(10 * 60000);
  await ctx.places.syncRemotes();
  assert.ok(vps.calls.length > calls);
  await until(() => m().busy && t().messages.find((x) => x.id === held.id).held === false);
  assert.ok(t().messages.find((x) => x.id === held.id).deliveredAt);
  await until(async () => (await ctx.places.jobs(placeId)).some((j) => j.state === 'done'));
  await teams.collect();
  assert.equal(m().busy, false);
  teams.stopAll({ id: teamId });
  fs.rmSync(dir, { recursive: true, force: true });
});
