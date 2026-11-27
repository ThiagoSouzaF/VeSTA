// Agent Mode in the main process: keeps state.agents, wakes them on their schedule and runs each time in a chat of its
// own (agentId set, outside Conversas) through the regular send flow, so memory, skills and permissions are the ones
// every chat has. A finished turn ('chat-done' on the bus) closes the run with a one-line summary.
// What the agent learns (its "Lição:" lines, a "Pedido sugerido:") waits for the person's yes before it counts.
// deps (tests): { send(ctx, args), now(), installed(provider), skill(name) -> { name, body } | null, setInterval,
//                 clearInterval }
const { randomUUID } = require('node:crypto');
const { UserError } = require('../app/errors.cjs');
const { redact } = require('../memory/redact.cjs');
const A = require('../shared/agents.cjs');
const R = require('../shared/refine.cjs');

const TICK_MS = 30000;

function createAgentEngine(ctx, deps = {}) {
  const store = ctx.store;
  const send = deps.send || ((...a) => require('../chat/send.cjs').send(...a));
  const now = deps.now || Date.now;
  const installed = deps.installed || ((p) => !!ctx.integrations?.[p]?.installed);
  // The agent's own skills, whole; one removed or turned off in the library is left out.
  const skill = deps.skill || ((name) => ctx.skills?.inline(name) || null);
  const agents = () => (store.state.agents ||= []);
  const find = (id) => {
    const a = agents().find((x) => x.id === id);
    if (!a) throw new UserError('Agent não encontrado');
    return a;
  };
  const commit = () => {
    store.save();
    ctx.sync?.();
  };
  // What the agent was before a change of its task or lessons, kept so it can come back (Refinar → Versões).
  const keepVersion = (a, note) => {
    a.versions = R.pushVersion(
      a.versions,
      { note, prompt: a.prompt, lessons: A.keptLessons(a).map((l) => l.text) },
      now()
    ).list;
  };
  const schedule = (a) => {
    a.nextRunAt = a.enabled ? A.nextRun(a.schedule, now()) : null;
  };

  // ---- Editing ---------------------------------------------------------------------------------------------------
  function create(input) {
    const a = A.normalizeAgent(input);
    Object.assign(a, { id: randomUUID(), runs: [], unseen: 0, createdAt: now(), updatedAt: now() });
    schedule(a);
    agents().unshift(a);
    commit();
    return a.id;
  }
  function update({ id, ...input }) {
    const prev = find(id);
    const a = A.normalizeAgent({ ...prev, ...input }, prev);
    if (a.prompt !== prev.prompt) keepVersion(a, 'Editado à mão');
    a.updatedAt = now();
    schedule(a);
    agents()[agents().indexOf(prev)] = a;
    commit();
  }
  function toggle({ id, enabled }) {
    const a = find(id);
    a.enabled = !!enabled;
    schedule(a);
    commit();
  }
  // The agent goes; the chats of its runs come back to Conversas (nothing becomes unreachable).
  function remove({ id }) {
    const a = find(id);
    if (A.isRunning(a)) throw new UserError('Espere o agent terminar ou pare a execução antes de apagar');
    ctx.places?.forget(a);
    store.state.agents = agents().filter((x) => x !== a);
    for (const c of store.state.chats) if (c.agentId === id) delete c.agentId;
    commit();
  }
  // The person's word on what the agent learned: keep, drop, or a lesson of their own (kept at once). A dropped lesson
  // stays hidden as 'dropped', so the agent does not propose it again; the person can still write it themselves.
  function lesson({ id, lessonId, action, text }) {
    const a = find(id);
    const lessons = (a.lessons ||= []);
    if (action === 'add') {
      const t = String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      if (!t) throw new UserError('Escreva a lição');
      const same = lessons.find((l) => A.sameLesson(l.text, t));
      if (same && same.status !== 'dropped') throw new UserError('O agent já tem esta lição');
      a.lessons = lessons.filter((l) => l !== same);
      a.lessons.unshift({ id: randomUUID(), text: t, status: 'kept', from: 'person', at: now(), runId: null });
    } else {
      const l = lessons.find((x) => x.id === lessonId);
      if (!l) throw new UserError('Lição não encontrada');
      if (action === 'keep') l.status = 'kept';
      else if (action === 'drop') Object.assign(l, { status: 'dropped', at: now() });
      else throw new UserError('Ação inválida');
    }
    commit();
  }
  // A suggested task replaces the prompt only on a yes; either way the suggestion goes.
  function suggestion({ id, accept }) {
    const a = find(id);
    if (!a.suggestion) return;
    if (accept) {
      keepVersion(a, 'Antes do pedido sugerido');
      Object.assign(a, { prompt: A.normalizeAgent({ ...a, prompt: a.suggestion.text }).prompt, updatedAt: now() });
    }
    a.suggestion = null;
    commit();
  }
  function seen() {
    for (const a of agents()) a.unseen = 0;
    commit();
  }

  // ---- Running ---------------------------------------------------------------------------------------------------
  function start(a, trigger) {
    if (A.isRunning(a)) throw new UserError('Este agent já está rodando');
    if (!installed(a.provider)) throw new UserError('A IA deste agent não está instalada (tela Conexões)');
    const project = a.projectId ? store.state.projects.find((p) => p.id === a.projectId) : null;
    const chat = store.addChat({
      provider: a.provider,
      model: a.model,
      projectId: project ? project.id : null,
      mode: a.mode,
      memory: a.memory,
    });
    const at = now();
    chat.title = (
      a.name +
      ' · ' +
      new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    ).slice(0, 100);
    chat.agentId = a.id;
    if (!a.skills) chat.skills = false;
    const run = {
      id: randomUUID(),
      at,
      endedAt: null,
      trigger,
      status: 'running',
      chatId: chat.id,
      summary: '',
      error: '',
    };
    a.runs = [run, ...(a.runs || [])].slice(0, A.MAX_RUNS);
    a.lastRunAt = at;
    schedule(a);
    commit();
    const skills = (a.skillNames || []).map(skill).filter(Boolean);
    const text = A.buildPrompt(a, { now: at, projectName: project?.name || '', skills });
    Promise.resolve()
      .then(() => send(ctx, { chatId: chat.id, text }))
      // The turn never started (no CLI, project folder gone...): there will be no 'chat-done'.
      .catch((e) => finish(a.id, run.id, 'error', '', e.message));
    return run.id;
  }
  // Installed in a place, it runs there (places/engine.cjs; then the answer is a promise, maybe over SSH); the diary
  // gets the run when it ends.
  function runNow({ id }) {
    if (A.installedSomewhere(find(id)))
      return ctx.places.runNow({ agentId: id }).then((r) => ({ runId: null, chatId: null, ...r }));
    return { runId: start(find(id), 'manual'), chatId: find(id).runs[0].chatId };
  }
  // A run that happened in a place, read from its folder: into the diary in time order, its lessons pending as usual.
  function importRun(agentId, rec, place) {
    const a = agents().find((x) => x.id === agentId);
    if (!a || (a.runs || []).some((r) => r.id === rec.id)) return false;
    const run = {
      id: rec.id,
      at: rec.at,
      endedAt: rec.endedAt,
      trigger: rec.trigger === 'manual' ? 'manual' : 'schedule',
      status: rec.status === 'ok' ? 'ok' : 'error',
      chatId: null,
      summary: A.summaryOf(rec.summary || ''),
      error: rec.error ? redact(String(rec.error)).slice(0, 400) : '',
      place,
      usage: rec.usage || null,
    };
    a.runs = [...(a.runs || []), run].sort((x, y) => y.at - x.at).slice(0, A.MAX_RUNS);
    if (run.status === 'ok' && rec.text) learn(a, String(rec.text), run.id, 'place');
    a.lastRunAt = Math.max(a.lastRunAt || 0, run.at);
    a.unseen = (a.unseen || 0) + 1;
    return true;
  }
  // "Lição:" lines become pending lessons (once each) and a "Pedido sugerido:" waits for a yes. Only kept lessons
  // reach the next runs (A.buildPrompt).
  function learn(a, text, runId, from) {
    const lessons = (a.lessons ||= []);
    for (const t of A.lessonsOf(text))
      if (!lessons.some((l) => A.sameLesson(l.text, t)))
        lessons.unshift({ id: randomUUID(), text: redact(t), status: 'pending', from, at: now(), runId });
    // Over the limit the oldest dropped ones go first (forgetting them only lets them be proposed again), then the
    // oldest pending ones; kept ones only when nothing else is left.
    while (lessons.length > A.MAX_LESSONS) {
      const statuses = lessons.map((l) => l.status);
      const i = [statuses.lastIndexOf('dropped'), statuses.lastIndexOf('pending')].find((x) => x >= 0);
      lessons.splice(i ?? lessons.length - 1, 1);
    }
    const suggested = A.suggestionOf(text);
    if (suggested && suggested !== a.prompt) a.suggestion = { text: redact(suggested), at: now(), runId };
  }
  function finish(agentId, runId, status, summary, error = '') {
    const a = agents().find((x) => x.id === agentId);
    const run = a?.runs?.find((r) => r.id === runId);
    if (!run || run.status !== 'running') return;
    if (summary) learn(a, summary, runId, 'run');
    Object.assign(run, {
      status,
      endedAt: now(),
      summary: A.summaryOf(summary),
      error: error ? redact(String(error)).slice(0, 400) : '',
    });
    a.unseen = (a.unseen || 0) + 1;
    commit();
  }
  // Every finished turn passes here; only the chats of agent runs matter.
  function onChatDone({ chatId, status }) {
    const chat = store.state.chats.find((c) => c.id === chatId);
    if (!chat?.agentId) return;
    const a = agents().find((x) => x.id === chat.agentId);
    const run = a?.runs?.find((r) => r.chatId === chatId && r.status === 'running');
    const reply = [...chat.messages].reverse().find((m) => m.role === 'assistant');
    // A later turn in the run's chat (the person corrected or asked more): only what it learned counts.
    if (!run) {
      const before = (a?.lessons || []).length,
        had = a?.suggestion;
      if (a && status === 'done' && reply?.text)
        learn(a, reply.text, a.runs?.find((r) => r.chatId === chatId)?.id || null, 'chat');
      if (a && ((a.lessons || []).length !== before || a.suggestion !== had)) commit();
      return;
    }
    if (status === 'done' && reply?.text) finish(a.id, run.id, 'ok', reply.text);
    else finish(a.id, run.id, 'error', reply?.text || '', reply?.error || 'A execução foi interrompida.');
  }

  // ---- Clock -----------------------------------------------------------------------------------------------------
  // Until the AIs are probed (ctx.integrations) nothing starts: a missed time would fail as "not installed".
  const ready = () => !!deps.installed || !!ctx.integrations;
  let missed = [];
  function failStart(a, trigger, e) {
    // Could not start (AI uninstalled...): the time is recorded as an error run, the next one stays scheduled.
    const t = now();
    a.runs = [
      { id: randomUUID(), at: t, endedAt: t, trigger, status: 'error', chatId: null, summary: '', error: e.message },
      ...(a.runs || []),
    ].slice(0, A.MAX_RUNS);
    a.unseen = (a.unseen || 0) + 1;
    schedule(a);
    commit();
  }
  function tick() {
    if (!ready()) return;
    const late = missed;
    missed = [];
    for (const [a, trigger] of [
      ...late.map((a) => [a, 'catch-up']),
      ...A.dueAgents(agents(), now()).map((a) => [a, 'schedule']),
    ])
      if (agents().includes(a) && a.enabled && !A.isRunning(a))
        try {
          start(a, trigger);
        } catch (e) {
          failStart(a, trigger, e);
        }
  }
  // At start: runs left "running" by the previous session are closed; a time missed while VeSTA was closed runs once
  // at the first tick (catch-up) or is skipped, and every other enabled agent gets its next time.
  function recover() {
    missed = [];
    for (const a of agents()) {
      for (const r of a.runs || [])
        if (r.status === 'running')
          Object.assign(r, { status: 'error', endedAt: now(), error: 'O VeSTA fechou durante a execução.' });
      if (a.enabled && a.nextRunAt && a.nextRunAt <= now() && a.catchUp && !A.installedSomewhere(a)) missed.push(a);
      else schedule(a);
    }
    if (agents().length) store.save();
    return missed.length;
  }
  let timer = null;
  // VESTA_AGENT_TICK_MS only shortens the 30 s clock for the E2E tests.
  function startClock() {
    recover();
    const every = deps.setInterval || setInterval;
    timer = every(tick, Number(process.env.VESTA_AGENT_TICK_MS) || TICK_MS);
    timer?.unref?.();
  }
  function stopClock() {
    if (timer) (deps.clearInterval || clearInterval)(timer);
    timer = null;
  }

  return {
    keepVersion,
    create,
    update,
    toggle,
    remove,
    lesson,
    suggestion,
    seen,
    runNow,
    importRun,
    onChatDone,
    tick,
    recover,
    startClock,
    stopClock,
  };
}

module.exports = { createAgentEngine, TICK_MS };
