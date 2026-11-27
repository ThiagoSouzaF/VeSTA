// A place on another machine (a VPS): the same runner as this PC's (runner/vesta-agent.cjs), copied into
// ~/.vesta-agents there and called through SSH (places/ssh.cjs). Its answers are the same JSON, so the places engine
// treats both alike. Connecting is a list of steps, each with the command it stands for, shown before and after.
const path = require('node:path').posix;
const { q, PROBE, readProbe, sshError, checkTarget } = require('./ssh.cjs');
const { connectPlan } = require('../shared/places.cjs');
const { remoteWriter } = require('../runner/files.cjs');

const AI_LABEL = { claude: 'claude', codex: 'codex', opencode: 'opencode' };
// ssh itself failed (no network, refused, wrong key): the place is offline, not broken.
class Offline extends Error {}
const offline = (r) => r.code === 255 || r.code === -1;

// place: { host, port, home, node } (what connect found).
function createRemote(place, { sh }) {
  const target = { host: place.host, port: place.port };
  const runnerFile = path.join(place.home, 'runner', 'vesta-agent.cjs');
  async function cli(args, { stdin = '', timeoutMs = 30000 } = {}) {
    const line = [q(place.node), q(runnerFile), ...args.map(q), '--home', q(place.home)].join(' ');
    const r = await sh(target, line, { stdin, timeoutMs });
    if (offline(r)) throw new Offline(sshError(r));
    let j;
    try {
      j = JSON.parse(r.out);
    } catch {
      throw new Error(sshError(r));
    }
    if (j && !Array.isArray(j) && j.error) throw new Error(j.error);
    return j;
  }
  return {
    status: () => cli(['status']),
    list: () => cli(['list']),
    runs: (slug, n = 30) => cli(['runs', slug, '--n', String(n)]),
    install: (pkg) => cli(['install', '-'], { stdin: JSON.stringify(pkg), timeoutMs: 60000 }),
    remove: (slug) => cli(['remove', slug]),
    setConfig: (patch) => cli(['config', '-'], { stdin: JSON.stringify(patch) }),
    // Team turns (runner jobs): the runner starts each one apart from the SSH session.
    startJob: (spec) => cli(['job', '-'], { stdin: JSON.stringify(spec) }),
    jobs: () => cli(['jobs']),
    stopJob: (id) => cli(['job-stop', id]),
    clearJob: (id) => cli(['job-clear', id]),
    // Apart from the SSH session, so it goes on after it closes (as the timer would start it).
    async start(slug) {
      const run = [q(place.node), q(runnerFile), 'run', q(slug), '--trigger', 'manual', '--home', q(place.home)];
      const r = await sh(target, 'nohup ' + run.join(' ') + ' </dev/null >/dev/null 2>&1 &');
      if (offline(r)) throw new Offline(sshError(r));
      if (r.code !== 0) throw new Error(sshError(r));
    },
    async writeRunner(version) {
      const r = await sh(target, q(place.node) + ' -', {
        stdin: remoteWriter({ home: place.home, node: place.node, version }),
        timeoutMs: 60000,
      });
      if (offline(r)) throw new Offline(sshError(r));
      try {
        return JSON.parse(String(r.out).trim().split('\n').pop());
      } catch {
        throw new Error(sshError(r));
      }
    },
    probe: async () => {
      const r = await sh(target, PROBE);
      if (offline(r)) throw new Offline(sshError(r));
      return readProbe(r.out);
    },
  };
}

// The config the runner there needs: each AI it found, how the timer starts it, the scheduler and the login PATH.
const configOf = (info, home) => ({
  ais: info.ais,
  launcher: { exe: info.node, args: [path.join(home, 'runner', 'vesta-agent.cjs')] },
  scheduler: info.scheduler,
  path: info.path,
});
// Steps: [{ label, cmd, status: 'ok' | 'warn' | 'error', detail }]. { ok, steps, place? }: the place to keep.
async function connect({ host, port }, { sh, version }) {
  const target = checkTarget({ host, port });
  const plan = connectPlan(target);
  const steps = [];
  const step = (i, status, detail = '', cmd = plan[i][1]) => steps.push({ label: plan[i][0], cmd, status, detail });
  const fail = () => ({ ok: false, steps });
  let info;
  try {
    info = await createRemote({ ...target, home: '~', node: 'node' }, { sh }).probe();
  } catch (e) {
    step(0, 'error', e.message);
    return fail();
  }
  step(0, 'ok', info.os);
  if (info.problem) {
    step(1, 'error', info.problem);
    return fail();
  }
  step(1, 'ok', info.nodeVersion);
  const home = path.join(info.home, '.vesta-agents');
  const remote = createRemote({ ...target, home, node: info.node }, { sh });
  let runner;
  try {
    runner = await remote.writeRunner(version);
    await remote.setConfig(configOf(info, home));
  } catch (e) {
    step(2, 'error', e.message, home + '/runner/');
    return fail();
  }
  step(2, 'ok', 'versão ' + runner.version, home + '/runner/');
  // Without linger, systemd stops the person's timers when they log out.
  const lingerCmd = 'loginctl enable-linger ' + (info.user || '$USER');
  if (info.scheduler !== 'systemd') step(3, 'warn', 'Sem systemd: os agents só rodam quando você pedir', '—');
  else if (info.linger !== false) step(3, 'ok', 'já ligado', lingerCmd);
  else {
    const r = await sh(target, 'loginctl enable-linger "$(id -un)"');
    if (r.code === 0) {
      step(3, 'ok', 'ligado agora', lingerCmd);
      info.linger = true;
    } else step(3, 'warn', 'Não deu sem sudo. Rode lá: sudo ' + lingerCmd, lingerCmd);
  }
  const found = Object.keys(AI_LABEL).map((id) => AI_LABEL[id] + (info.ais[id] ? ' ✓' : ' —'));
  step(4, Object.keys(info.ais).length ? 'ok' : 'warn', found.join(' · ') + ' · drael só no Windows');
  return {
    ok: true,
    steps,
    place: {
      ...target,
      home,
      node: info.node,
      path: info.path,
      os: info.os,
      kind: info.kind,
      scheduler: info.scheduler,
      linger: info.linger,
      user: info.user,
      ais: info.ais,
      runner,
    },
  };
}

module.exports = { createRemote, connect, configOf, Offline };
