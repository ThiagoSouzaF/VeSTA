// Onde rodam: the Task Scheduler task, the runner of the agents folder (install, run with a fake AI, records, remove)
// and the places engine that installs from VeSTA and brings the runs back to the diary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const A = require('../electron/shared/agents.cjs');
const { taskXml, triggersXml, quoteArg, createScheduler } = require('../electron/runner/scheduler.cjs');
const { createRunner, slugOf, packageHash, aiCommand, FORMAT } = require('../electron/runner/vesta-agent.cjs');
const { writeRunner, installedRunner, runnerHash, FILES } = require('../electron/runner/files.cjs');
const { agentArgs } = require('../electron/runner/launch.cjs');
const { Store } = require('../electron/app/store.cjs');
const { createAgentEngine } = require('../electron/agents/engine.cjs');
const { createPlaces } = require('../electron/places/engine.cjs');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-places-' + name + '-'));
// A fake Claude: answers in the -p JSON format, echoing what it was asked to the side file FAKE_SEEN.
function fakeClaude(dir, { reply, fail = false } = {}) {
  const file = path.join(dir, 'fake-claude.cjs');
  fs.writeFileSync(
    file,
    `let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'seen.txt'))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input }));
  ${fail ? "process.stderr.write('login vencido\\n'); process.exit(3);" : ''}
  console.log(JSON.stringify({ type: 'result', is_error: false, result: ${JSON.stringify(reply || 'Feito.\nResumo: tudo certo.\nLição: confira a porta 4319 antes.')}, usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } }));
});`
  );
  return { exe: process.execPath, args: [file] };
}
const seen = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'seen.txt'), 'utf8'));
const pkg = (over = {}) => {
  const p = {
    format: FORMAT,
    vestaId: 'a1',
    name: 'Bom dia do VeSTA',
    prompt: 'Leia os commits de ontem.',
    provider: 'claude',
    model: 'haiku',
    mode: 'read',
    schedule: { kind: 'daily', time: '08:30', days: [], hours: 4 },
    catchUp: true,
    lessons: ['Comece pelo teste que falhou.'],
    skills: [{ name: 'resumo-commits', body: 'Agrupe os commits por projeto.' }],
    cwd: null,
    projectName: '',
    ...over,
  };
  p.hash = packageHash(p);
  return p;
};
// Records what the scheduler was asked, without touching the real one.
function spyScheduler() {
  const calls = [];
  return {
    calls,
    kind: 'spy',
    taskName: (slug) => '\\VeSTA\\vesta-agent-' + slug,
    describe: () => '',
    register: async (slug, opts) => (calls.push(['register', slug, opts]), opts.schedule.kind !== 'manual'),
    unregister: async (slug) => calls.push(['unregister', slug]),
    exists: async () => false,
  };
}

test('Task Scheduler: one trigger per kind of schedule, none for the manual one', () => {
  const now = new Date(2026, 10, 27, 10, 0);
  assert.match(triggersXml({ kind: 'daily', time: '08:30' }, now), /2026-11-27T08:30:00.*<DaysInterval>1</);
  const week = triggersXml({ kind: 'weekdays', time: '23:50' }, now);
  assert.match(week, /<Monday \/><Tuesday \/><Wednesday \/><Thursday \/><Friday \/>/);
  assert.doesNotMatch(week, /Sunday|Saturday/);
  assert.match(triggersXml({ kind: 'weekly', time: '07:00', days: [0, 6] }, now), /<Sunday \/><Saturday \/>/);
  assert.match(triggersXml({ kind: 'interval', hours: 6 }, now), /2026-11-27T16:00:00.*<Interval>PT6H</);
  assert.equal(triggersXml({ kind: 'manual' }, now), null);
  assert.equal(taskXml({ name: 'x', schedule: { kind: 'manual' }, command: 'a.exe' }), null);
});

test('Task Scheduler: the task runs as the person, once at a time, with escaped and quoted arguments', () => {
  const xml = taskXml({
    name: 'Testes & noite',
    schedule: { kind: 'daily', time: '23:50' },
    catchUp: false,
    command: 'C:\\Program Files\\VeSTA\\VeSTA.exe',
    args: ['--vesta-agent', 'run', 'testes', '--home', 'C:\\Users\\voce\\VeSTA agents'],
  });
  assert.match(xml, /Testes &amp; noite/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew</);
  assert.match(xml, /<StartWhenAvailable>false</);
  assert.match(xml, /<Command>C:\\Program Files\\VeSTA\\VeSTA.exe<\/Command>/);
  assert.match(xml, /--home &quot;C:\\Users\\voce\\VeSTA agents&quot;/);
  assert.equal(quoteArg('a b'), '"a b"');
  assert.equal(quoteArg('ab'), 'ab');
});

test('Task Scheduler: register goes through schtasks with an XML file it then removes', async () => {
  const calls = [];
  const s = createScheduler({ kind: 'windows', folder: 'VeSTA-teste', run: async (f, args) => calls.push([f, args]) });
  assert.equal(
    await s.register('bom-dia', {
      name: 'Bom dia',
      schedule: { kind: 'daily', time: '08:30' },
      command: 'v.exe',
      args: [],
    }),
    true
  );
  const [file, args] = calls[0];
  assert.equal(file, 'schtasks');
  assert.deepEqual(args.slice(0, 2), ['/create', '/tn']);
  assert.equal(args[2], '\\VeSTA-teste\\vesta-agent-bom-dia');
  assert.equal(fs.existsSync(args[4]), false, 'the XML file is gone');
  assert.equal(await s.register('m', { name: 'M', schedule: { kind: 'manual' }, command: 'v.exe' }), false);
  assert.deepEqual(calls[1][1].slice(0, 2), ['/delete', '/tn'], 'a manual schedule removes the old task');
  assert.equal(createScheduler({ kind: 'none' }).kind, 'none');
});

test('runner: names become folder names', () => {
  assert.equal(slugOf('Bom dia do VeSTA'), 'bom-dia-do-vesta');
  assert.equal(slugOf('Faxina: memória & ações!'), 'faxina-memoria-acoes');
  assert.equal(slugOf('***'), 'agent');
});

test('runner: install, run with the AI, keep the record, update in place, remove', async () => {
  const home = tmp('runner');
  const sched = spyScheduler();
  const runner = createRunner({ home, scheduler: sched });
  runner.setConfig({ ais: { claude: fakeClaude(home) }, launcher: { exe: 'VeSTA.exe', args: ['--vesta-agent'] } });
  const r = await runner.install(pkg());
  assert.equal(r.slug, 'bom-dia-do-vesta');
  assert.equal(r.task, '\\VeSTA\\vesta-agent-bom-dia-do-vesta');
  assert.deepEqual(sched.calls[0][2].args, ['--vesta-agent', 'run', 'bom-dia-do-vesta', '--home', home]);
  const dir = path.join(home, 'agents', r.slug);
  assert.equal(
    fs.readFileSync(path.join(dir, 'skills', 'resumo-commits.md'), 'utf8'),
    'Agrupe os commits por projeto.'
  );
  assert.ok(fs.existsSync(path.join(dir, 'work')));

  const out = await runner.run(r.slug, { trigger: 'manual' });
  assert.equal(out.run.status, 'ok');
  assert.equal(out.run.summary, 'tudo certo.');
  const asked = seen(home);
  assert.deepEqual(asked.args.slice(0, 3), ['-p', '--output-format', 'json']);
  assert.ok(asked.args.includes('plan'), 'read mode never edits');
  assert.equal(path.resolve(asked.cwd), path.resolve(path.join(dir, 'work')));
  assert.match(asked.input, /com o VeSTA fechado/);
  assert.match(asked.input, /- Comece pelo teste que falhou\./);
  assert.match(asked.input, /<skill nome="resumo-commits">/);
  const [rec] = runner.runs(r.slug);
  assert.deepEqual(rec.lessons, ['confira a porta 4319 antes.']);
  assert.deepEqual(rec.usage, { input: 10, cached: 90, output: 5 });
  assert.equal(rec.trigger, 'manual');
  assert.equal(fs.existsSync(path.join(dir, 'running.json')), false);

  // The same agent again keeps its folder and runs; another one with the same name gets its own.
  const again = await runner.install(pkg({ prompt: 'Outro pedido.' }));
  assert.equal(again.slug, r.slug);
  assert.equal(again.updated, true);
  assert.equal(runner.runs(r.slug).length, 1);
  assert.equal((await runner.install(pkg({ vestaId: 'a2' }))).slug, 'bom-dia-do-vesta-2');
  const list = runner.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].last.summary, 'tudo certo.');

  await runner.remove(r.slug);
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(sched.calls.at(-1), ['unregister', r.slug]);
  fs.rmSync(home, { recursive: true, force: true });
});

test('runner: a failing AI, a missing AI and a run already going', async () => {
  const home = tmp('fail');
  const runner = createRunner({ home, scheduler: spyScheduler() });
  runner.setConfig({ ais: { claude: fakeClaude(home, { fail: true }) } });
  const { slug } = await runner.install(pkg());
  const bad = await runner.run(slug);
  assert.equal(bad.run.status, 'error');
  assert.match(bad.run.error, /login vencido/);
  // The next run is told about the failure.
  runner.setConfig({ ais: { claude: fakeClaude(home) } });
  await runner.run(slug);
  assert.match(seen(home).input, /Execuções que falharam/);

  runner.setConfig({ ais: {} });
  assert.match((await runner.run(slug)).run.error, /Claude não está instalado neste lugar/);

  fs.writeFileSync(path.join(home, 'agents', slug, 'running.json'), JSON.stringify({ pid: process.pid, at: 1 }));
  assert.equal((await runner.run(slug)).skipped, 'já está rodando');
  await assert.rejects(runner.remove(slug), /rodando/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('runner: a package with a bad skill name or an unknown AI is refused', async () => {
  const home = tmp('bad');
  const runner = createRunner({ home, scheduler: spyScheduler() });
  await assert.rejects(runner.install(pkg({ skills: [{ name: '../x', body: '' }] })), /skill inválido/);
  await assert.rejects(runner.install(pkg({ provider: 'gemini' })), /IA desconhecida/);
  await assert.rejects(runner.install({ format: 9 }), /formato/);
  assert.throws(() => runner.runs('../..'), /inválido/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('runner: each AI in its one-shot mode, never asking', () => {
  const ai = { exe: 'x' };
  const codex = aiCommand({ provider: 'codex', mode: 'edit', model: 'gpt-5' }, ai, 'p', os.tmpdir()).args;
  assert.deepEqual(codex.slice(0, 3), ['exec', '-c', 'analytics.enabled=false']);
  assert.ok(codex.includes('danger-full-access') && codex.at(-1) === '-');
  const oc = aiCommand({ provider: 'opencode', mode: 'read' }, ai, 'pedido', os.tmpdir());
  assert.deepEqual(oc.args.slice(0, 5), ['run', '--format', 'json', '--agent', 'plan']);
  assert.equal(oc.args.at(-1), 'pedido');
  assert.equal(JSON.parse(oc.env.OPENCODE_PERMISSION).edit, 'deny');
  const dr = aiCommand(
    { provider: 'drael', mode: 'read' },
    { exe: path.join('D', 'node', 'node.exe') },
    'p',
    os.tmpdir()
  );
  assert.equal(dr.args[0], path.join('D', 'drael.js'));
  assert.ok(dr.args.includes('plan'));
  const parsed = oc.parse(
    [
      JSON.stringify({ type: 'text', part: { text: 'Oi. ' } }),
      JSON.stringify({ type: 'text', part: { text: 'Resumo: ok' } }),
      JSON.stringify({
        type: 'step_finish',
        part: { tokens: { input: 3, output: 2, reasoning: 1, cache: { read: 7 } } },
      }),
    ].join('\n')
  );
  assert.deepEqual(parsed, { text: 'Oi. Resumo: ok', error: '', usage: { input: 3, cached: 7, output: 3 } });
});

test('runner files: copied with a hash, a .cmd to use them by hand, the scheduler flag of VeSTA', () => {
  const home = tmp('files');
  assert.equal(installedRunner(home), null);
  const info = writeRunner(home, { version: '0.33.0', launcher: { exe: 'C:\\VeSTA\\VeSTA.exe' } });
  assert.equal(info.hash, runnerHash());
  assert.deepEqual(installedRunner(home).version, '0.33.0');
  for (const [name] of FILES) assert.ok(fs.existsSync(path.join(home, 'runner', name)), name);
  assert.match(
    fs.readFileSync(path.join(home, 'runner', 'vesta-agent.cmd'), 'utf8'),
    /ELECTRON_RUN_AS_NODE=1\r\n"C:\\VeSTA\\VeSTA.exe"/
  );
  // The copy works on its own (its siblings, not the app's).
  const copy = require(path.join(home, 'runner', 'vesta-agent.cjs'));
  assert.equal(copy.slugOf('Olá Mundo'), 'ola-mundo');
  assert.deepEqual(agentArgs(['VeSTA.exe', '--vesta-agent', 'run', 'x']), ['run', 'x']);
  assert.equal(agentArgs(['VeSTA.exe']), null);
  fs.rmSync(home, { recursive: true, force: true });
});

test('prompt: standalone runs know there is no memory', () => {
  const p = A.buildPrompt({ name: 'X', prompt: 'Faça.', skills: true }, { standalone: true, projectName: 'Mora' });
  assert.match(p, /com o VeSTA fechado: sem a memória do VeSTA. Trabalhe com a pasta do projeto Mora/);
  assert.doesNotMatch(A.buildPrompt({ name: 'X', prompt: 'Faça.' }), /VeSTA fechado/);
});

test('an agent installed in a place is never started by VeSTA’s clock', () => {
  const due = { enabled: true, nextRunAt: 1, runs: [] };
  assert.equal(A.dueAgents([due], 10).length, 1);
  assert.equal(A.dueAgents([{ ...due, places: { pc: { slug: 'x' } } }], 10).length, 0);
  assert.equal(A.installedSomewhere({ places: {} }), false);
});

// ---- The places engine, on a real store ----------------------------------------------------------------------------
function setup() {
  const dir = tmp('engine');
  const home = path.join(dir, 'agents');
  const store = new Store(path.join(dir, 'vesta.json'));
  const ctx = {
    store,
    sync() {},
    integrations: { claude: { installed: true, exe: process.execPath, runArgs: fakeClaude(dir).args } },
    skills: { inline: (n) => (n === 'resumo' ? { name: 'resumo', body: 'Agrupe.' } : null) },
  };
  ctx.agents = createAgentEngine(ctx, { send: async () => {}, installed: () => true });
  const spawned = [];
  ctx.places = createPlaces(ctx, {
    home,
    scheduler: spyScheduler(),
    launcher: { exe: 'VeSTA.exe', args: ['--vesta-agent'] },
    version: '0.33.0',
    spawn: (exe, args, opts) => (spawned.push({ exe, args, opts }), { unref() {} }),
  });
  const id = ctx.agents.create({
    name: 'Testes de toda noite',
    prompt: 'Rode os testes.',
    provider: 'claude',
    mode: 'ask',
    skillNames: ['resumo', 'sumiu'],
    schedule: { kind: 'daily', time: '23:50' },
  });
  return { dir, home, ctx, id, spawned, a: () => store.state.agents.find((x) => x.id === id) };
}

test('places: install packs the agent, writes the runner and marks where it runs', async () => {
  const { dir, home, ctx, id, a } = setup();
  const pkgOf = ctx.places.packageOf(a());
  assert.equal(pkgOf.mode, 'read', '"Pedir permissão" runs as read: nobody approves');
  assert.deepEqual(pkgOf.skills, [{ name: 'resumo', body: 'Agrupe.' }], 'a skill gone from the library stays out');
  const { results } = await ctx.places.install({ agentIds: [id] });
  assert.equal(results[0].slug, 'testes-de-toda-noite');
  assert.equal(a().places.pc.slug, 'testes-de-toda-noite');
  assert.equal(installedRunner(home).version, '0.33.0');
  const view = ctx.places.view().places[0];
  assert.equal(view.id, 'pc');
  assert.equal(view.runner.outdated, false);
  assert.equal(view.agents[0].agentId, id);
  assert.equal(view.agents[0].outdated, false);
  assert.ok(view.commands[0].includes('vesta-agent.cmd'));
  // Changing the task leaves the install outdated until "Atualizar".
  ctx.agents.update({ id, ...a(), prompt: 'Rode os testes e o build.' });
  assert.equal(ctx.places.view().places[0].agents[0].outdated, true);
  await ctx.places.sync();
  assert.equal(a().places.pc.outdated, true);
  await ctx.places.update({ agentId: id });
  assert.equal(ctx.places.view().places[0].agents[0].outdated, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('places: a run in the folder comes back to the diary with its lessons waiting for a yes', async () => {
  const { dir, home, ctx, id, a, spawned } = setup();
  await ctx.places.install({ agentIds: [id] });
  await ctx.places.runNow({ agentId: id });
  assert.deepEqual(spawned[0].args, [
    '--vesta-agent',
    'run',
    'testes-de-toda-noite',
    '--trigger',
    'manual',
    '--home',
    home,
  ]);
  assert.equal(spawned[0].opts.detached, true);
  assert.equal(spawned[0].opts.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.ok(a().places.pc.running, 'running right after the click');
  // What the launched runner would do:
  await createRunner({ home, scheduler: spyScheduler() }).run('testes-de-toda-noite', { trigger: 'manual' });
  assert.equal(await ctx.places.sync(), true);
  assert.equal(a().places.pc.running, null, 'the run that began after the click ended it');
  const run = a().runs[0];
  assert.equal(run.place, 'pc');
  assert.equal(run.summary, 'tudo certo.');
  assert.equal(run.chatId, null);
  assert.equal(a().unseen, 1);
  assert.deepEqual(
    a().lessons.map((l) => [l.text, l.status, l.from]),
    [['confira a porta 4319 antes.', 'pending', 'place']]
  );
  assert.equal(await ctx.places.sync(), false, 'imported once');
  // The card's "Rodar agora" goes to the place too.
  assert.equal((await ctx.agents.runNow({ id })).slug, 'testes-de-toda-noite');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('places: remove takes it out of the folder; a folder removed by hand is noticed; deleting the agent cleans up', async () => {
  const { dir, home, ctx, id, a } = setup();
  await ctx.places.install({ agentIds: [id] });
  await ctx.places.remove({ agentId: id });
  assert.equal(a().places.pc, undefined);
  assert.equal(fs.existsSync(path.join(home, 'agents', 'testes-de-toda-noite')), false);
  await ctx.places.install({ agentIds: [id] });
  fs.rmSync(path.join(home, 'agents', 'testes-de-toda-noite'), { recursive: true });
  await ctx.places.sync();
  assert.equal(a().places.pc, undefined);
  await ctx.places.install({ agentIds: [id] });
  ctx.agents.remove({ id });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(path.join(home, 'agents', 'testes-de-toda-noite')), false);
  await assert.rejects(ctx.places.install({ agentIds: [] }), /ao menos um/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('places: an AI not installed on this PC is reported per agent', async () => {
  const { dir, ctx, id } = setup();
  ctx.integrations.claude.installed = false;
  const { results } = await ctx.places.install({ agentIds: [id] });
  assert.match(results[0].error, /não está instalada neste PC/);
  fs.rmSync(dir, { recursive: true, force: true });
});
