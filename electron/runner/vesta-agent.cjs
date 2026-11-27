// vesta-agent: runs VeSTA's agents with VeSTA closed (this PC, or a VPS reached by SSH: places/remote.cjs). Only Node built-ins and three sibling
// files, because VeSTA copies this folder into the agents folder (runner/files.cjs) and the system scheduler starts it
// from there. Inside the app the siblings come from their own places (shared/, app/).
//
// The agents folder (VESTA_AGENTS_HOME, else %LOCALAPPDATA%\VeSTA\agents or ~/.vesta-agents):
//   runner/            this program (version.json says which VeSTA wrote it), vesta-agent.cmd to use it by hand
//   config.json        { ais: { claude: { exe, args? } ... }, launcher: { exe, args }, scheduler, timeoutMin, path? }
//                      path: the PATH the AIs run with (a VPS's login PATH: a systemd timer starts with a bare one)
//   agents/<slug>/     agent.json (what VeSTA sent), skills/<name>.md, work/ (folder for agents without a project),
//                      runs/<time>-<id>.json (one per run), running.json (while one runs)
//
// Commands (always JSON on stdout): status | list | install <pacote.json | -> | config <patch.json | -> | remove <slug>
// | run <slug> [--trigger t] | runs <slug> [--n 10]; all take --home <pasta>; "-" reads the JSON from stdin.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const near = (file, inApp) =>
  require(fs.existsSync(path.join(__dirname, file)) ? path.join(__dirname, file) : path.join(__dirname, inApp));
const A = near('agents.cjs', '../shared/agents.cjs');
const { childEnv, CODEX_PRIVATE_ARGS } = near('privacy.cjs', '../app/privacy.cjs');
const { createScheduler } = require('./scheduler.cjs');

const FORMAT = 1;
const AI_NAME = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', drael: 'Drael' };
const MAX_RECORDS = 60;
const MAX_TEXT = 20000;
const MAX_OUT = 8 * 1024 * 1024;

function defaultHome() {
  if (process.env.VESTA_AGENTS_HOME) return process.env.VESTA_AGENTS_HOME;
  if (process.platform === 'win32')
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'VeSTA', 'agents');
  return path.join(os.homedir(), '.vesta-agents');
}
const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
// "Bom dia do VeSTA" -> "bom-dia-do-vesta": the folder and the scheduler entry.
const slugOf = (name) =>
  String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'agent';
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
// What makes two installs of an agent the same: VeSTA compares it to tell an outdated one.
function packageHash(pkg) {
  const { hash: _hash, ...rest } = pkg;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 12);
}
function checkPackage(pkg) {
  if (!pkg || pkg.format !== FORMAT) throw new Error('Pacote de agent em formato desconhecido');
  if (!pkg.vestaId || !String(pkg.name || '').trim() || !String(pkg.prompt || '').trim())
    throw new Error('Pacote de agent incompleto');
  if (!AI_NAME[pkg.provider]) throw new Error('IA desconhecida: ' + pkg.provider);
  for (const s of pkg.skills || [])
    if (!/^[\w.-]+$/.test(String(s.name || ''))) throw new Error('Nome de skill inválido: ' + s.name);
}

// ---- The AIs, each in its one-shot mode ------------------------------------------------------------------------
// 'read' never edits (Claude plan, Codex read-only sandbox, OpenCode plan agent, Drael plan); 'edit' does without asking:
// nobody is there to approve.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const lines = (out) =>
  String(out)
    .split(/\r?\n/)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
function draelKey() {
  if (process.env.DRAEL_KEY) return process.env.DRAEL_KEY;
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'drael');
  try {
    return fs.readFileSync(path.join(dir, 'credential'), 'utf8').trim();
  } catch {
    return '';
  }
}
function aiCommand(agent, ai, prompt, scratch) {
  const edit = agent.mode === 'edit';
  const pre = ai.args || [];
  const model = String(agent.model || '');
  if (agent.provider === 'claude')
    return {
      args: [
        ...pre,
        '-p',
        '--output-format',
        'json',
        '--no-session-persistence',
        '--permission-mode',
        edit ? 'bypassPermissions' : 'plan',
        ...(model ? ['--model', model] : []),
      ],
      stdin: prompt,
      parse(out) {
        const j =
          lines(out)
            .reverse()
            .find((x) => x.type === 'result') || {};
        const u = j.usage || {};
        return {
          text: String(j.result || ''),
          error: j.is_error ? String(j.result || j.subtype || 'O Claude terminou com erro') : '',
          usage: {
            input: num(u.input_tokens),
            cached: num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
            output: num(u.output_tokens),
          },
        };
      },
    };
  if (agent.provider === 'codex') {
    const last = path.join(scratch, 'codex-ultima.txt');
    return {
      args: [
        ...pre,
        'exec',
        ...CODEX_PRIVATE_ARGS,
        '--skip-git-repo-check',
        '--ephemeral',
        '--json',
        '-s',
        edit ? 'danger-full-access' : 'read-only',
        '-o',
        last,
        ...(model ? ['-m', model] : []),
        '-',
      ],
      stdin: prompt,
      parse(out) {
        const events = lines(out);
        const u = events.reverse().find((e) => e.type === 'turn.completed')?.usage || {};
        const failed = events.find((e) => e.type === 'turn.failed' || e.type === 'error');
        let text = '';
        try {
          text = fs.readFileSync(last, 'utf8');
        } catch {}
        // Codex counts the cache inside the input.
        return {
          text,
          error: failed ? String(failed.error?.message || failed.message || 'O Codex terminou com erro') : '',
          usage: {
            input: Math.max(0, num(u.input_tokens) - num(u.cached_input_tokens)),
            cached: num(u.cached_input_tokens),
            output: num(u.output_tokens),
          },
        };
      },
    };
  }
  if (agent.provider === 'opencode') {
    const permission = edit
      ? { edit: 'allow', bash: 'allow', webfetch: 'allow', question: 'deny' }
      : { edit: 'deny', bash: 'deny', webfetch: 'allow', question: 'deny' };
    return {
      args: [
        ...pre,
        'run',
        '--format',
        'json',
        '--agent',
        edit ? 'build' : 'plan',
        ...(model ? ['-m', model] : []),
        prompt,
      ],
      env: { OPENCODE_PERMISSION: JSON.stringify(permission) },
      parse(out) {
        const events = lines(out);
        const text = events
          .filter((e) => e.type === 'text')
          .map((e) => e.part?.text || '')
          .join('');
        const usage = { input: 0, cached: 0, output: 0 };
        for (const e of events.filter((x) => x.type === 'step_finish')) {
          const t = e.part?.tokens || {};
          usage.input += num(t.input);
          usage.cached += num(t.cache?.read) + num(t.cache?.write);
          usage.output += num(t.output) + num(t.reasoning);
        }
        const failed = events.find((e) => e.type === 'error');
        return {
          text,
          error: failed
            ? String(failed.error?.data?.message || failed.error?.message || 'O OpenCode terminou com erro')
            : '',
          usage,
        };
      },
    };
  }
  // Drael: node.exe runs drael.js, which sits one folder above the bundled node (see ai/drael.cjs).
  const script = ai.script || path.join(path.dirname(path.dirname(ai.exe)), 'drael.js');
  return {
    args: [...pre, script, '-p', '--output-format', 'stream', '--max-turns', '64', '--mode', edit ? 'bypass' : 'plan'],
    stdin: prompt,
    env: { DRAEL_KEY: draelKey() },
    parse(out) {
      const events = lines(out);
      const end = events.find((e) => e.type === 'end') || {};
      const cached = num(end.usage?.cached);
      return {
        text: events
          .filter((e) => e.type === 'text')
          .map((e) => e.text)
          .join(''),
        error: end.refused ? 'O Drael recusou o pedido' : '',
        usage: { input: Math.max(0, num(end.usage?.input) - cached), cached, output: num(end.usage?.output) },
      };
    },
  };
}

// One AI call: the prompt in, the reply out; killed after `timeoutMs`.
function ask(agent, ai, prompt, { cwd, timeoutMs, scratch }) {
  const spec = aiCommand(agent, ai, prompt, scratch);
  const env = childEnv(spec.env || {});
  delete env.ELECTRON_RUN_AS_NODE; // the scheduler starts this program through VeSTA's own executable
  return new Promise((resolve) => {
    let out = '',
      err = '',
      done = false;
    const child = spawn(ai.exe, spec.args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ text: '', error: 'Passou de ' + Math.round(timeoutMs / 60000) + ' min e foi interrompido.' });
    }, timeoutMs);
    child.stdout.on('data', (d) => out.length < MAX_OUT && (out += d));
    child.stderr.on('data', (d) => err.length < 64000 && (err += d));
    child.on('error', (e) => finish({ text: '', error: e.message }));
    child.on('close', (code) => {
      let r;
      try {
        r = spec.parse(out);
      } catch (e) {
        r = { text: '', error: e.message };
      }
      if (!r.text && !r.error && code === 0) r.text = out.trim();
      if (!r.error && code !== 0)
        r.error = (err.trim().split(/\r?\n/).slice(-3).join(' ') || 'Saiu com código ' + code).slice(0, 400);
      finish(r);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(spec.stdin || '');
  });
}

// ---- The runner ----------------------------------------------------------------------------------------------------
function createRunner({ home = defaultHome(), scheduler = null, now = Date.now } = {}) {
  const configFile = path.join(home, 'config.json');
  const agentsDir = path.join(home, 'agents');
  const dirOf = (slug) => {
    if (!/^[a-z0-9-]+$/.test(String(slug))) throw new Error('Agent inválido: ' + slug);
    return path.join(agentsDir, slug);
  };
  const config = () => readJson(configFile, {}) || {};
  const sched = () =>
    scheduler ||
    createScheduler({
      kind: process.env.VESTA_AGENT_SCHEDULER || config().scheduler || undefined,
      dir: config().unitDir || undefined,
      folder: config().taskFolder || 'VeSTA',
    });
  const readAgent = (slug) => readJson(path.join(dirOf(slug), 'agent.json'));
  const slugs = () => {
    try {
      return fs
        .readdirSync(agentsDir)
        .filter((d) => /^[a-z0-9-]+$/.test(d) && fs.existsSync(path.join(agentsDir, d, 'agent.json')));
    } catch {
      return [];
    }
  };
  const lockFile = (slug) => path.join(dirOf(slug), 'running.json');
  const running = (slug) => {
    const l = readJson(lockFile(slug));
    return l && alive(l.pid) ? l : null;
  };
  const recordFiles = (slug) => {
    try {
      return fs
        .readdirSync(path.join(dirOf(slug), 'runs'))
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  };
  const records = (slug, n = 30) =>
    recordFiles(slug)
      .slice(0, n)
      .map((f) => readJson(path.join(dirOf(slug), 'runs', f)))
      .filter(Boolean);
  const brief = (r) =>
    r && { id: r.id, at: r.at, endedAt: r.endedAt, status: r.status, summary: r.summary, error: r.error };

  function setConfig(patch) {
    writeJson(configFile, { ...config(), ...patch });
  }
  function status() {
    const c = config();
    return {
      home,
      runner: readJson(path.join(home, 'runner', 'version.json'), {}) || {},
      scheduler: sched().kind,
      ais: Object.fromEntries(Object.keys(AI_NAME).map((k) => [k, !!(c.ais?.[k]?.exe && fs.existsSync(c.ais[k].exe))])),
      agents: slugs().length,
    };
  }
  function list() {
    return slugs().map((slug) => {
      const a = readAgent(slug);
      const lock = running(slug);
      return {
        slug,
        vestaId: a.vestaId,
        name: a.name,
        provider: a.provider,
        model: a.model || '',
        mode: a.mode,
        schedule: a.schedule,
        hash: a.hash,
        installedAt: a.installedAt,
        updatedAt: a.updatedAt,
        task: a.task || '',
        running: lock ? { at: lock.at, runId: lock.runId } : null,
        last: brief(records(slug, 1)[0]) || null,
        runs: recordFiles(slug).length,
      };
    });
  }
  // A new agent gets a folder of its own; the same agent (vestaId) again keeps its folder, its runs and work/.
  async function install(pkg) {
    checkPackage(pkg);
    const c = config();
    const mine = slugs().find((s) => readAgent(s)?.vestaId === pkg.vestaId);
    let slug = mine;
    if (!slug) {
      const base = slugOf(pkg.name);
      slug = base;
      for (let i = 2; fs.existsSync(dirOf(slug)); i++) slug = base + '-' + i;
    }
    const dir = dirOf(slug);
    const prev = mine ? readAgent(slug) : null;
    fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
    fs.rmSync(path.join(dir, 'skills'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'skills'));
    for (const s of pkg.skills || []) fs.writeFileSync(path.join(dir, 'skills', s.name + '.md'), String(s.body || ''));
    const { skills, ...rest } = pkg;
    const agent = {
      ...rest,
      skillNames: (skills || []).map((s) => s.name),
      hash: pkg.hash || packageHash(pkg),
      slug,
      installedAt: prev?.installedAt || now(),
      updatedAt: now(),
    };
    const launcher = c.launcher;
    const scheduled =
      !!launcher?.exe &&
      (await sched().register(slug, {
        name: pkg.name,
        schedule: pkg.schedule,
        catchUp: pkg.catchUp !== false,
        command: launcher.exe,
        args: [...(launcher.args || []), 'run', slug, '--home', home],
      }));
    agent.task = scheduled ? sched().taskName(slug) : '';
    writeJson(path.join(dir, 'agent.json'), agent);
    return { slug, hash: agent.hash, task: agent.task, updated: !!mine };
  }
  async function remove(slug) {
    if (!readAgent(slug)) throw new Error('Agent não instalado aqui: ' + slug);
    if (running(slug)) throw new Error('O agent está rodando; espere terminar');
    await sched().unregister(slug);
    fs.rmSync(dirOf(slug), { recursive: true, force: true });
    return { slug, removed: true };
  }
  async function run(slug, { trigger = 'schedule' } = {}) {
    const a = readAgent(slug);
    if (!a) throw new Error('Agent não instalado aqui: ' + slug);
    if (running(slug)) return { slug, skipped: 'já está rodando' };
    const dir = dirOf(slug);
    const at = now();
    const id = randomUUID();
    writeJson(lockFile(slug), { pid: process.pid, at, runId: id });
    if (config().path) process.env.PATH = config().path;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-agent-'));
    let r;
    try {
      const ai = config().ais?.[a.provider];
      if (!ai?.exe || !fs.existsSync(ai.exe)) throw new Error(AI_NAME[a.provider] + ' não está instalado neste lugar');
      const history = records(slug, 20).map((x) => ({ ...brief(x), status: x.status }));
      const skills = (a.skillNames || [])
        .map((name) => {
          try {
            return { name, body: fs.readFileSync(path.join(dir, 'skills', name + '.md'), 'utf8') };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const prompt = A.buildPrompt(
        {
          name: a.name,
          prompt: a.prompt,
          skills: false,
          lessons: (a.lessons || []).map((text) => ({ text, status: 'kept' })),
          runs: history,
        },
        { now: at, projectName: a.projectName || '', skills, standalone: true }
      );
      const cwd = a.cwd && fs.existsSync(a.cwd) ? a.cwd : path.join(dir, 'work');
      r = await ask(a, ai, prompt, { cwd, scratch, timeoutMs: (Number(config().timeoutMin) || 60) * 60000 });
    } catch (e) {
      r = { text: '', error: e.message };
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    const text = String(r.text || '');
    const record = {
      id,
      at,
      endedAt: now(),
      trigger,
      status: r.error ? 'error' : 'ok',
      summary: A.summaryOf(text),
      error: String(r.error || '').slice(0, 400),
      text: text.slice(0, MAX_TEXT),
      lessons: A.lessonsOf(text),
      suggestion: A.suggestionOf(text),
      usage: r.usage || null,
      provider: a.provider,
      model: a.model || '',
      hash: a.hash,
    };
    writeJson(path.join(dir, 'runs', String(at).padStart(14, '0') + '-' + id + '.json'), record);
    for (const f of recordFiles(slug).slice(MAX_RECORDS)) fs.rmSync(path.join(dir, 'runs', f), { force: true });
    fs.rmSync(lockFile(slug), { force: true });
    return { slug, run: brief(record) };
  }
  const runs = (slug, { n = 30 } = {}) => {
    if (!readAgent(slug)) throw new Error('Agent não instalado aqui: ' + slug);
    return records(slug, n);
  };
  return { home, config, setConfig, status, list, install, remove, run, runs, readAgent };
}

// ---- Command line --------------------------------------------------------------------------------------------------
const input = (arg) => {
  if (arg !== '-') return readJson(arg);
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
};
function parseArgs(argv) {
  const pos = [],
    opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--'))
      opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else pos.push(argv[i]);
  }
  return { pos, opt };
}
async function main(argv, { out = (s) => process.stdout.write(s + '\n') } = {}) {
  const { pos, opt } = parseArgs(argv);
  const runner = createRunner({ home: typeof opt.home === 'string' ? opt.home : defaultHome() });
  const [cmd, arg] = pos;
  try {
    let result;
    if (cmd === 'status') result = runner.status();
    else if (cmd === 'list') result = runner.list();
    else if (cmd === 'install') result = await runner.install(input(arg) || {});
    else if (cmd === 'config') {
      runner.setConfig(input(arg) || {});
      result = runner.status();
    } else if (cmd === 'remove') result = await runner.remove(arg);
    else if (cmd === 'run')
      result = await runner.run(arg, { trigger: typeof opt.trigger === 'string' ? opt.trigger : 'schedule' });
    else if (cmd === 'runs') result = runner.runs(arg, { n: Number(opt.n) || 30 });
    else {
      out(
        'Uso: vesta-agent status | list | install <pacote.json> | config <json> | remove <agent> | run <agent> | runs <agent> [--home pasta]'
      );
      return cmd ? 2 : 0;
    }
    out(JSON.stringify(result, null, 2));
    return 0;
  } catch (e) {
    out(JSON.stringify({ error: e.message }));
    return 1;
  }
}

module.exports = { createRunner, main, defaultHome, slugOf, packageHash, aiCommand, FORMAT };
if (require.main === module) main(process.argv.slice(2)).then((code) => (process.exitCode = code));
