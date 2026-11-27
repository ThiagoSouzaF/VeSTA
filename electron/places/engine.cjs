// Onde rodam: the places where VeSTA's agents run with VeSTA closed. "Este PC" (pc) is the agents folder here
// (runner/vesta-agent.cjs) plus the Task Scheduler; each VPS (state.places) is the same folder on another machine,
// reached by SSH (places/remote.cjs) with its own scheduler (systemd). VeSTA packs an agent (task, kept lessons, own
// skills, schedule), installs it there, and brings each finished run back to the agent's diary, where its lessons wait
// for a yes as usual. An agent installed somewhere is no longer started by VeSTA's own clock (shared/agents.cjs).
//
// This PC is read live; a VPS is read every few minutes (sooner while one of its agents runs) and between reads the
// screen shows the last list VeSTA got (`snapshot`), marked offline when SSH failed.
// state.places = [{ id, name, host, port, home, node, path, os, kind, scheduler, linger, user, ais, runner,
//                   online, seen, error, snapshot: { list, at } }]
// deps (tests): { home, scheduler, launcher, version, spawn, sh, setInterval, clearInterval, now }
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn: nodeSpawn } = require('node:child_process');
const { UserError } = require('../app/errors.cjs');
const { childEnv } = require('../app/privacy.cjs');
const A = require('../shared/agents.cjs');
const { createRunner, defaultHome, packageHash, FORMAT } = require('../runner/vesta-agent.cjs');
const { installedRunner, runnerHash, writeRunner } = require('../runner/files.cjs');
const { createSsh, sshLine } = require('./ssh.cjs');
const { createRemote, connect: connectRemote, configOf, Offline } = require('./remote.cjs');

const PC = 'pc';
const SYNC_MS = 20000;
const REMOTE_SYNC_MS = 3 * 60000;
const AI_IDS = ['claude', 'codex', 'opencode', 'drael'];

// What starts the runner: VeSTA's own executable (the portable one is unpacked to a temp folder on each start, so its
// real path comes from electron-builder's variable); in development, Electron with the app folder.
function defaultLauncher(app) {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  return { exe, args: app?.isPackaged === false ? [app.getAppPath(), '--vesta-agent'] : ['--vesta-agent'] };
}

function createPlaces(ctx, deps = {}) {
  const store = ctx.store;
  const now = deps.now || Date.now;
  const home = deps.home || process.env.VESTA_AGENTS_HOME || defaultHome();
  const local = createRunner({ home, scheduler: deps.scheduler });
  const sh = deps.sh || createSsh();
  const launcher = () => deps.launcher || defaultLauncher(ctx.app);
  const version = () => deps.version || ctx.app?.getVersion?.() || '0';
  const spawn = deps.spawn || nodeSpawn;
  const remoteMs = () => Number(process.env.VESTA_REMOTE_SYNC_MS) || REMOTE_SYNC_MS;
  const agents = () => store.state.agents || [];
  const remotes = () => (store.state.places ||= []);
  const find = (id) => {
    const a = agents().find((x) => x.id === id);
    if (!a) throw new UserError('Agent não encontrado');
    return a;
  };
  const remoteOf = (id) => {
    const p = remotes().find((x) => x.id === id);
    if (!p) throw new UserError('Lugar não encontrado');
    return p;
  };
  const nameOf = (id) => (id === PC ? 'Este PC' : remotes().find((x) => x.id === id)?.name || id);
  const inPlace = (id) => (id === PC ? 'neste PC' : 'em ' + nameOf(id));
  const installedAt = (a, placeId) => a.places?.[placeId] || null;
  // The place an agent runs from when none is named: the first one it was installed in.
  const placeOfAgent = (a, placeId) => placeId || Object.keys(a.places || {})[0] || PC;
  const slugOf = (a, placeId) => {
    const p = installedAt(a, placeId);
    if (!p) throw new UserError('Este agent não está instalado ' + inPlace(placeId));
    return p.slug;
  };
  const commit = () => {
    store.save();
    ctx.sync?.();
  };

  // ---- What goes into a place ------------------------------------------------------------------------------------
  // This PC: each AI as VeSTA found it (ctx.integrations; `args` only in tests, a fake AI run by node). A VPS: what
  // its probe found when it was connected or refreshed.
  const pcAis = () =>
    Object.fromEntries(
      AI_IDS.filter((id) => ctx.integrations?.[id]?.installed && ctx.integrations[id].exe).map((id) => [
        id,
        {
          exe: ctx.integrations[id].exe,
          ...(ctx.integrations[id].runArgs ? { args: ctx.integrations[id].runArgs } : {}),
        },
      ])
    );
  const hasAi = (placeId, provider) =>
    placeId === PC ? !!ctx.integrations?.[provider]?.installed : !!remoteOf(placeId).ais?.[provider];
  // On a VPS there is no project folder of this PC: the agent works in its own work/ folder there.
  function packageOf(a, placeId = PC) {
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
      cwd: placeId === PC ? project?.path || null : null,
      projectName: project?.name || '',
    };
    pkg.hash = packageHash(pkg);
    return pkg;
  }

  // ---- Reaching a place -------------------------------------------------------------------------------------------
  // The same calls for both kinds: list, runs, install, remove, start (a run apart from VeSTA), prepare (the runner and
  // its config, before installing), updateRunner.
  function access(placeId) {
    if (placeId === PC)
      return {
        list: async () => local.list(),
        runs: async (slug, n) => local.runs(slug, { n }),
        install: (pkg) => local.install(pkg),
        remove: (slug) => local.remove(slug),
        async start(slug) {
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
        },
        async prepare() {
          if (!installedRunner(home)) writeRunner(home, { version: version(), launcher: launcher() });
          local.setConfig({ ais: pcAis(), launcher: launcher() });
        },
        async updateRunner() {
          const info = writeRunner(home, { version: version(), launcher: launcher() });
          local.setConfig({ ais: pcAis(), launcher: launcher() });
          return info;
        },
      };
    const p = remoteOf(placeId);
    const r = createRemote(p, { sh });
    // Every SSH call says whether the place answered; an offline one keeps its last list.
    const seen =
      (fn) =>
      async (...args) => {
        try {
          const out = await fn(...args);
          Object.assign(p, { online: true, seen: now(), error: '' });
          return out;
        } catch (e) {
          if (!(e instanceof Offline)) throw new UserError(e.message);
          Object.assign(p, { online: false, error: e.message });
          throw new UserError('Sem conexão com ' + p.name + ': ' + e.message);
        }
      };
    return {
      list: seen(r.list),
      runs: seen(r.runs),
      install: seen(r.install),
      remove: seen(r.remove),
      start: seen(r.start),
      prepare: async () => {},
      updateRunner: seen(async () => {
        p.runner = await r.writeRunner(version());
        await r.setConfig(configOf(p, p.home));
        return p.runner;
      }),
      probe: seen(r.probe),
    };
  }

  // ---- Reading the places ------------------------------------------------------------------------------------------
  function decorate(list, placeId) {
    const byId = new Map(agents().map((a) => [a.id, a]));
    return list.map((x) => {
      const a = byId.get(x.vestaId);
      return {
        ...x,
        agentId: a ? a.id : null,
        outdated: a ? packageOf(a, placeId).hash !== x.hash : false,
        next: a && a.schedule?.kind !== 'manual' ? A.nextRun(a.schedule, now()) : null,
      };
    });
  }
  const latest = () => ({ version: version(), hash: runnerHash() });
  function pcView() {
    const st = local.status();
    const windows = st.scheduler === 'windows';
    const bin = path.join(home, 'runner', 'vesta-agent.cmd');
    return {
      id: PC,
      name: 'Este PC',
      kind: windows ? 'Windows · Agendador de Tarefas' : 'Sem agendador · só quando você pedir',
      scheduler: st.scheduler,
      home,
      online: true,
      remote: false,
      runner: { installed: st.runner?.hash ? st.runner : null, latest: latest(), outdated: outdated(st.runner) },
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
      agents: decorate(local.list(), PC),
    };
  }
  const outdated = (r) => !!r?.hash && r.hash !== runnerHash();
  function remoteView(p) {
    const systemd = p.scheduler === 'systemd';
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      scheduler: p.scheduler,
      home: p.home,
      host: p.host,
      port: p.port,
      address: sshLine(p),
      linger: p.linger,
      online: p.online !== false,
      seen: p.seen || null,
      error: p.error || '',
      readAt: p.snapshot?.at || null,
      remote: true,
      runner: { installed: p.runner?.hash ? p.runner : null, latest: latest(), outdated: outdated(p.runner) },
      ais: Object.fromEntries(
        AI_IDS.map((id) => [
          id,
          id === 'drael'
            ? { installed: false, note: 'só no Windows por enquanto' }
            : { installed: !!p.ais?.[id], authenticated: null },
        ])
      ),
      commands: [
        sshLine(p),
        p.home + '/runner/vesta-agent list',
        ...(systemd
          ? ["systemctl --user list-timers 'vesta-agent-*'", "journalctl --user -u 'vesta-agent-*' -n 50"]
          : []),
      ],
      agents: decorate(p.snapshot?.list || [], p.id),
    };
  }
  const view = () => ({ places: [pcView(), ...remotes().map(remoteView)] });

  // ---- Bringing the runs back -------------------------------------------------------------------------------------
  // Every finished run not yet in the diary goes there (oldest first); "running" and "outdated" follow the folder.
  // An agent whose folder was removed by hand is no longer installed there.
  async function absorb(placeId, list, readRuns) {
    const byVesta = new Map(list.map((x) => [x.vestaId, x]));
    let changed = false;
    for (const a of agents().filter((x) => installedAt(x, placeId))) {
      const p = a.places[placeId];
      const x = byVesta.get(a.id);
      if (!x) {
        delete a.places[placeId];
        changed = true;
        continue;
      }
      // Right after "Rodar agora" the runner is still starting: the click counts as running for up to a minute, until a
      // run that began after it shows up.
      const ranSince = x.last && x.last.at >= (p.running || 0) - 2000;
      const running = x.running ? x.running.at : p.running && !ranSince && now() - p.running < 60000 ? p.running : null;
      if ((p.running || null) !== running) {
        p.running = running;
        changed = true;
      }
      const old = packageOf(a, placeId).hash !== x.hash;
      if (!!p.outdated !== old) {
        p.outdated = old;
        changed = true;
      }
      if (x.last && !(a.runs || []).some((r) => r.id === x.last.id)) {
        const known = new Set((a.runs || []).map((r) => r.id));
        for (const rec of (await readRuns(x.slug, 10)).reverse())
          if (!known.has(rec.id) && ctx.agents.importRun(a.id, rec, placeId)) changed = true;
      }
    }
    return changed;
  }
  async function syncPc() {
    if (!agents().some((a) => installedAt(a, PC))) return false;
    let list;
    try {
      list = local.list();
    } catch {
      return false;
    }
    const changed = await absorb(PC, list, (slug, n) => local.runs(slug, { n }));
    if (changed) commit();
    return changed;
  }
  // One VPS: its list (kept as the snapshot) and the runs it has that the diary does not.
  const reading = new Set();
  async function syncRemote(p) {
    if (reading.has(p.id)) return false;
    reading.add(p.id);
    const wasOnline = p.online;
    try {
      const io = access(p.id);
      const list = await io.list();
      p.snapshot = { list, at: now() };
      await absorb(p.id, list, io.runs);
      commit();
      return true;
    } catch {
      if (wasOnline !== p.online) commit();
      return false;
    } finally {
      reading.delete(p.id);
    }
  }
  // The VPS due for a read: every few minutes, every tick while one of its agents runs.
  const due = (p) => {
    const busy = agents().some((a) => installedAt(a, p.id)?.running);
    return now() - (p.snapshot?.at || 0) >= (busy ? SYNC_MS : remoteMs()) - 1000;
  };
  const syncRemotes = ({ all = false } = {}) =>
    Promise.all(
      remotes()
        .filter((p) => all || due(p))
        .map(syncRemote)
    ).then((r) => r.some(Boolean));
  // This PC now; the VPS that are due, without waiting for them (the screen gets them on its next read).
  async function sync() {
    const changed = await syncPc();
    syncRemotes().catch(() => {});
    return changed;
  }

  // ---- Changing a place -------------------------------------------------------------------------------------------
  async function installOne(io, a, placeId) {
    if (!hasAi(placeId, a.provider))
      throw new UserError('A IA de "' + a.name + '" não está instalada ' + inPlace(placeId));
    const r = await io.install(packageOf(a, placeId));
    a.places = { ...(a.places || {}), [placeId]: { slug: r.slug, hash: r.hash, at: now(), task: r.task } };
    return r;
  }
  async function install({ placeId = PC, agentIds = [] }) {
    if (!agentIds.length) throw new UserError('Escolha ao menos um agent');
    const io = access(placeId);
    await io.prepare();
    const results = [];
    for (const id of agentIds) {
      const a = find(id);
      try {
        results.push({ id, ...(await installOne(io, a, placeId)) });
      } catch (e) {
        results.push({ id, error: e.message });
      }
    }
    if (placeId !== PC) await syncRemote(remoteOf(placeId));
    commit();
    return { results };
  }
  // The runs still in the folder come to the diary first, so nothing done there is lost.
  const syncPlace = (placeId) => (placeId === PC ? syncPc() : syncRemote(remoteOf(placeId)));
  async function update({ agentId, placeId }) {
    const a = find(agentId);
    placeId = placeOfAgent(a, placeId);
    slugOf(a, placeId);
    const io = access(placeId);
    await io.prepare();
    await syncPlace(placeId);
    const r = await installOne(io, a, placeId);
    if (placeId !== PC) await syncRemote(remoteOf(placeId));
    commit();
    return r;
  }
  async function remove({ agentId, placeId }) {
    const a = find(agentId);
    placeId = placeOfAgent(a, placeId);
    const slug = slugOf(a, placeId);
    await syncPlace(placeId);
    await access(placeId).remove(slug);
    delete a.places[placeId];
    if (placeId !== PC) await syncRemote(remoteOf(placeId));
    commit();
  }
  // Removing the agent from VeSTA takes it out of every place too (an offline VPS keeps it until it is forgotten).
  async function forget(a) {
    for (const [placeId, p] of Object.entries(a.places || {}))
      try {
        await access(placeId).remove(p.slug);
      } catch {}
  }
  // A manual run starts apart from VeSTA (it goes on if VeSTA closes), the same way the scheduler starts it.
  async function runNow({ agentId, placeId }) {
    const a = find(agentId);
    placeId = placeOfAgent(a, placeId);
    const slug = slugOf(a, placeId);
    const known = placeId === PC ? local.list() : remoteOf(placeId).snapshot?.list || [];
    if (known.find((x) => x.slug === slug)?.running) throw new UserError('Este agent já está rodando');
    const io = access(placeId);
    await io.prepare();
    await io.start(slug);
    a.places[placeId].running = now();
    commit();
    return { slug, placeId };
  }
  async function runs({ agentId, placeId }) {
    const a = find(agentId);
    placeId = placeOfAgent(a, placeId);
    return access(placeId).runs(slugOf(a, placeId), 30);
  }
  async function updateRunner({ placeId = PC } = {}) {
    const info = await access(placeId).updateRunner();
    commit();
    return info;
  }

  // ---- Connecting and forgetting a VPS ----------------------------------------------------------------------------
  // { ok, steps, placeId? }: the steps are shown whether it worked or not.
  async function connect({ name, host, port }) {
    const r = await connectRemote({ host, port }, { sh, version: version() });
    if (!r.ok) return { ok: false, steps: r.steps };
    const label =
      String(name || '')
        .trim()
        .slice(0, 40) || r.place.host.split('@').pop();
    const same = remotes().find((p) => p.host === r.place.host && p.port === r.place.port);
    const place = Object.assign(same || { id: 'vps-' + randomUUID().slice(0, 8) }, r.place, {
      name: label,
      online: true,
      seen: now(),
      error: '',
    });
    if (!same) remotes().push(place);
    await syncRemote(place);
    commit();
    return { ok: true, steps: r.steps, placeId: place.id };
  }
  // Read the VPS again, its AIs included (installed one there since?).
  async function refresh({ placeId = PC } = {}) {
    if (placeId === PC) return { changed: await syncPc() };
    const p = remoteOf(placeId);
    const info = await access(placeId).probe();
    Object.assign(p, { ais: info.ais, kind: info.kind, os: info.os, linger: info.linger, path: info.path });
    if (p.runner?.hash) await createRemote(p, { sh }).setConfig(configOf(p, p.home));
    await syncRemote(p);
    commit();
    return { changed: true };
  }
  // Its agents come out of the VPS first (their runs into the diary); one that could not stays there, said in `left`.
  // The runner folder stays on the VPS (removing it is the person's: rm -rf ~/.vesta-agents).
  async function forgetPlace({ placeId }) {
    const p = remoteOf(placeId);
    const mine = agents().filter((a) => installedAt(a, placeId));
    let left = 0;
    if (mine.length) {
      await syncRemote(p);
      for (const a of mine)
        try {
          await access(placeId).remove(a.places[placeId].slug);
        } catch {
          left++;
        }
    }
    for (const a of mine) delete a.places[placeId];
    store.state.places = remotes().filter((x) => x.id !== placeId);
    commit();
    return { left };
  }

  let timer = null;
  function startClock() {
    sync().catch(() => {});
    timer = (deps.setInterval || setInterval)(
      () => sync().catch(() => {}),
      Number(process.env.VESTA_PLACES_SYNC_MS) || SYNC_MS
    );
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
    connect,
    refresh,
    forgetPlace,
    packageOf,
    sync,
    syncRemotes,
    startClock,
    stopClock,
  };
}

module.exports = { createPlaces, defaultLauncher, PC };
