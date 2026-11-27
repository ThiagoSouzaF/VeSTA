// Onde rodam: the places where VeSTA's agents run with VeSTA closed. Phase 1 has one, this PC: the agents folder
// (runner/vesta-agent.cjs) plus the Task Scheduler. VeSTA packs an agent (task, kept lessons, own skills, schedule),
// installs it there, and brings each finished run back to the agent's diary, where its lessons wait for a yes as usual.
// An agent installed somewhere is no longer started by VeSTA's own clock (shared/agents.cjs dueAgents).
// deps (tests): { home, scheduler, launcher, version, spawn, setInterval, clearInterval }
const path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');
const { UserError } = require('../app/errors.cjs');
const { childEnv } = require('../app/privacy.cjs');
const A = require('../shared/agents.cjs');
const { createRunner, defaultHome, packageHash, FORMAT } = require('../runner/vesta-agent.cjs');
const { installedRunner, runnerHash, writeRunner } = require('../runner/files.cjs');

const PC = 'pc';
const SYNC_MS = 20000;
const AI_IDS = ['claude', 'codex', 'opencode', 'drael'];

// What starts the runner: VeSTA's own executable (the portable one is unpacked to a temp folder on each start, so its
// real path comes from electron-builder's variable); in development, Electron with the app folder.
function defaultLauncher(app) {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  return { exe, args: app?.isPackaged === false ? [app.getAppPath(), '--vesta-agent'] : ['--vesta-agent'] };
}

function createPlaces(ctx, deps = {}) {
  const store = ctx.store;
  const home = deps.home || process.env.VESTA_AGENTS_HOME || defaultHome();
  const runner = createRunner({ home, scheduler: deps.scheduler });
  const launcher = () => deps.launcher || defaultLauncher(ctx.app);
  const version = () => deps.version || ctx.app?.getVersion?.() || '0';
  const spawn = deps.spawn || nodeSpawn;
  const agents = () => store.state.agents || [];
  const find = (id) => {
    const a = agents().find((x) => x.id === id);
    if (!a) throw new UserError('Agent não encontrado');
    return a;
  };
  const installedAt = (a) => a.places?.[PC] || null;
  const slugOf = (a) => {
    const p = installedAt(a);
    if (!p) throw new UserError('Este agent não está instalado neste PC');
    return p.slug;
  };
  const commit = () => {
    store.save();
    ctx.sync?.();
  };

  // ---- What goes into the folder -----------------------------------------------------------------------------------
  // Each AI as VeSTA found it (ctx.integrations); an extra `args` only in tests (a fake AI run by node).
  const ais = () =>
    Object.fromEntries(
      AI_IDS.filter((id) => ctx.integrations?.[id]?.installed && ctx.integrations[id].exe).map((id) => [
        id,
        {
          exe: ctx.integrations[id].exe,
          ...(ctx.integrations[id].runArgs ? { args: ctx.integrations[id].runArgs } : {}),
        },
      ])
    );
  function packageOf(a) {
    const project = a.projectId ? store.state.projects.find((p) => p.id === a.projectId) : null;
    const skills = (a.skillNames || [])
      .map((n) => ctx.skills?.inline(n))
      .filter(Boolean)
      .map((k) => ({ name: k.name, body: k.body }));
    const pkg = {
      format: FORMAT,
      vestaId: a.id,
      name: a.name,
      prompt: a.prompt,
      provider: a.provider,
      model: a.model || '',
      // Nobody is there to approve a step: "Pedir permissão" runs as "Só consulta".
      mode: a.mode === 'edit' ? 'edit' : 'read',
      schedule: a.schedule,
      catchUp: a.catchUp !== false,
      lessons: A.keptLessons(a).map((l) => l.text),
      skills,
      cwd: project?.path || null,
      projectName: project?.name || '',
    };
    pkg.hash = packageHash(pkg);
    return pkg;
  }
  // The runner of the folder, written when there is none; a newer one only on the person's click (updateRunner).
  function prepare() {
    if (!installedRunner(home)) writeRunner(home, { version: version(), launcher: launcher() });
    runner.setConfig({ ais: ais(), launcher: launcher() });
  }

  // ---- Reading the place -------------------------------------------------------------------------------------------
  function view() {
    const st = runner.status();
    const list = runner.list();
    const latest = { version: version(), hash: runnerHash() };
    const byId = new Map(agents().map((a) => [a.id, a]));
    const windows = st.scheduler === 'windows';
    const bin = path.join(home, 'runner', 'vesta-agent.cmd');
    return {
      places: [
        {
          id: PC,
          name: 'Este PC',
          kind: windows ? 'Windows · Agendador de Tarefas' : 'Sem agendador · só quando você pedir',
          scheduler: st.scheduler,
          home,
          online: true,
          runner: {
            installed: st.runner?.hash ? st.runner : null,
            latest,
            outdated: !!st.runner?.hash && st.runner.hash !== latest.hash,
          },
          ais: Object.fromEntries(
            AI_IDS.map((id) => [
              id,
              {
                installed: !!ctx.integrations?.[id]?.installed,
                authenticated: ctx.integrations?.[id]?.authenticated ?? null,
              },
            ])
          ),
          commands: [
            '"' + bin + '" list',
            ...(windows ? ['schtasks /query /tn "\\VeSTA\\"'] : []),
            'explorer "' + home + '"',
          ],
          agents: list.map((x) => {
            const a = byId.get(x.vestaId);
            return {
              ...x,
              agentId: a ? a.id : null,
              outdated: a ? packageOf(a).hash !== x.hash : false,
              next: a && a.schedule?.kind !== 'manual' ? A.nextRun(a.schedule, Date.now()) : null,
            };
          }),
        },
      ],
    };
  }

  // ---- Changing it ------------------------------------------------------------------------------------------------
  async function installOne(a) {
    if (!ctx.integrations?.[a.provider]?.installed)
      throw new UserError('A IA de "' + a.name + '" não está instalada neste PC');
    const r = await runner.install(packageOf(a));
    a.places = { ...(a.places || {}), [PC]: { slug: r.slug, hash: r.hash, at: Date.now(), task: r.task } };
    return r;
  }
  async function install({ agentIds = [] }) {
    if (!agentIds.length) throw new UserError('Escolha ao menos um agent');
    prepare();
    const results = [];
    for (const id of agentIds) {
      const a = find(id);
      try {
        results.push({ id, ...(await installOne(a)) });
      } catch (e) {
        results.push({ id, error: e.message });
      }
    }
    commit();
    return { results };
  }
  async function update({ agentId }) {
    const a = find(agentId);
    slugOf(a);
    prepare();
    sync();
    const r = await installOne(a);
    commit();
    return r;
  }
  // The runs still in the folder come to the diary first, so nothing done there is lost.
  async function remove({ agentId }) {
    const a = find(agentId);
    const slug = slugOf(a);
    sync();
    await runner.remove(slug);
    delete a.places[PC];
    commit();
  }
  // Removing the agent from VeSTA takes it out of the folder and the scheduler too.
  async function forget(a) {
    const p = installedAt(a);
    if (p)
      try {
        await runner.remove(p.slug);
      } catch {}
  }
  // A manual run starts apart from VeSTA (it goes on if VeSTA closes), the same way the scheduler starts it.
  function runNow({ agentId }) {
    const a = find(agentId);
    const slug = slugOf(a);
    if (runner.list().find((x) => x.slug === slug)?.running) throw new UserError('Este agent já está rodando');
    prepare();
    const l = launcher();
    const env = childEnv();
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(l.exe, [...(l.args || []), 'run', slug, '--trigger', 'manual', '--home', home], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    });
    child.unref?.();
    a.places[PC].running = Date.now();
    commit();
    return { slug };
  }
  function runs({ agentId }) {
    return runner.runs(slugOf(find(agentId)), { n: 30 });
  }
  function updateRunner() {
    const info = writeRunner(home, { version: version(), launcher: launcher() });
    runner.setConfig({ ais: ais(), launcher: launcher() });
    return info;
  }

  // ---- Bringing the runs back -------------------------------------------------------------------------------------
  // Every finished run not yet in the diary goes there (oldest first); "running" and "outdated" follow the folder.
  // An agent whose folder was removed by hand is no longer installed.
  function sync() {
    const installed = agents().filter(installedAt);
    if (!installed.length) return false;
    let list;
    try {
      list = new Map(runner.list().map((x) => [x.vestaId, x]));
    } catch {
      return false;
    }
    let changed = false;
    for (const a of installed) {
      const p = a.places[PC];
      const x = list.get(a.id);
      if (!x) {
        delete a.places[PC];
        changed = true;
        continue;
      }
      // Right after "Rodar agora" the runner is still starting: the click counts as running for up to a minute, until a
      // run that began after it shows up.
      const ranSince = x.last && x.last.at >= (p.running || 0) - 2000;
      const running = x.running
        ? x.running.at
        : p.running && !ranSince && Date.now() - p.running < 60000
          ? p.running
          : null;
      if ((p.running || null) !== running) {
        p.running = running;
        changed = true;
      }
      const outdated = packageOf(a).hash !== x.hash;
      if (!!p.outdated !== outdated) {
        p.outdated = outdated;
        changed = true;
      }
      if (x.last && !(a.runs || []).some((r) => r.id === x.last.id)) {
        const known = new Set((a.runs || []).map((r) => r.id));
        for (const rec of runner.runs(x.slug, { n: 10 }).reverse())
          if (!known.has(rec.id) && ctx.agents.importRun(a.id, rec, PC)) changed = true;
      }
    }
    if (changed) commit();
    return changed;
  }
  let timer = null;
  function startClock() {
    sync();
    timer = (deps.setInterval || setInterval)(sync, Number(process.env.VESTA_PLACES_SYNC_MS) || SYNC_MS);
    timer?.unref?.();
  }
  function stopClock() {
    if (timer) (deps.clearInterval || clearInterval)(timer);
    timer = null;
  }

  return {
    home,
    view,
    install,
    update,
    remove,
    forget,
    runNow,
    runs,
    updateRunner,
    packageOf,
    sync,
    startClock,
    stopClock,
  };
}

module.exports = { createPlaces, defaultLauncher, PC };
