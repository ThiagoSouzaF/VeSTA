// Consolidation of the shared memory by an AI the person picks (tela Memória → Consolidar). Closed conversation stretches
// wait in state.memoryToConsolidate (sessions.cjs puts them there); a run, by the button or on the schedule, hands
// each project's stretches, with the memories that came from conversations (to merge the repeated ones), to the AI in
// a hidden chat (mode read, no memory, `memoryConsolidation` set) through the regular send flow, and writes the pages
// of its answer (consolidate.cjs) to AI Memory and to the Memória screen, deleting the memories they replace.
//
// state.consolidation = { provider, model, schedule (shared/agents.cjs), nextRunAt, runs: [Run] (newest first) }
// Run { id, at, endedAt, trigger: 'manual' | 'schedule', provider, status: 'running' | 'ok' | 'error', stretches,
//       reviewed (memories sent), pages (written), removed (merged or redundant, deleted), error }
// state.consolidation.compactedAt = { projectId: time }: the button reviews every project's memories; the schedule only
// the projects with something new since the last pass.
// deps (tests): { send(ctx, args), now(), installed(provider), setInterval, clearInterval }
const { randomUUID } = require('node:crypto');
const { UserError } = require('../app/errors.cjs');
const { redact } = require('./redact.cjs');
const { scope } = require('./protocol.cjs');
const A = require('../shared/agents.cjs');
const C = require('./consolidate.cjs');

const TICK_MS = 60000;
const TURN_MS = 15 * 60 * 1000;
const MAX_RUNS = 10;
const MAX_ATTEMPTS = 3;
const PROVIDERS = ['claude', 'codex', 'opencode', 'drael'];

function normalizeConfig(input) {
  input ||= {};
  const provider = PROVIDERS.includes(input.provider) ? input.provider : 'claude';
  let schedule;
  try {
    schedule = A.normalizeSchedule(input.schedule || { kind: 'daily', time: '03:00' });
  } catch {
    schedule = A.normalizeSchedule({ kind: 'daily', time: '03:00' });
  }
  return {
    provider,
    model: String(input.model || '').slice(0, 120),
    schedule,
    nextRunAt: Number(input.nextRunAt) || null,
    runs: Array.isArray(input.runs) ? input.runs.slice(0, MAX_RUNS) : [],
    // projectId ('' = personal space) -> when its memories were last reviewed for repetitions.
    compactedAt: input.compactedAt && typeof input.compactedAt === 'object' ? input.compactedAt : {},
  };
}

function createConsolidator(ctx, deps = {}) {
  const store = ctx.store;
  const state = () => store.state;
  const send = deps.send || ((...a) => require('../chat/send.cjs').send(...a));
  const now = deps.now || Date.now;
  const installed = deps.installed || ((p) => !!ctx.integrations?.[p]?.installed);
  // Until the AIs are probed a scheduled run waits: it would fail as "not installed".
  const probed = (p) => !!deps.installed || ctx.integrations?.[p] !== undefined;
  const cfg = () => (state().consolidation ||= normalizeConfig());
  const waiting = () => (state().memoryToConsolidate ||= []);
  const chatOf = (id) => state().chats.find((c) => c.id === id);
  const waiters = new Map(); // hidden chat id -> { resolve, reject, timer }
  let current = null;
  const commit = () => {
    store.save();
    ctx.sync?.();
  };
  const schedule = () => {
    cfg().nextRunAt = A.nextRun(cfg().schedule, now());
  };

  // ---- Queue (sessions.cjs) ---------------------------------------------------------------------------------------
  function enqueue(s, chatId) {
    if (!s?.turns || waiting().some((i) => i.sessionId === s.id)) return;
    waiting().push({
      sessionId: s.id,
      chatId,
      projectId: s.projectId || null,
      provider: s.provider,
      startedAt: s.startedAt,
      endedAt: now(),
      turns: s.turns,
      attempts: 0,
    });
    commit();
  }
  // A deleted chat is never consolidated: its content should not outlive it.
  function forgetChat(chatId) {
    const before = waiting().length;
    state().memoryToConsolidate = waiting().filter((i) => i.chatId !== chatId);
    if (waiting().length !== before) commit();
  }

  // ---- Settings ---------------------------------------------------------------------------------------------------
  function configure({ provider, model, schedule: sch } = {}) {
    if (provider !== undefined && !PROVIDERS.includes(provider)) throw new UserError('Escolha a IA que vai consolidar');
    const c = cfg();
    if (provider !== undefined) Object.assign(c, { provider, model: provider === c.provider ? c.model : '' });
    if (model !== undefined) c.model = String(model || '').slice(0, 120);
    if (sch !== undefined) c.schedule = A.normalizeSchedule(sch);
    schedule();
    commit();
  }

  // ---- One turn in a hidden chat ----------------------------------------------------------------------------------
  function turn(chat, text) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(chat.id);
        ctx.stopChat?.(chat.id);
        reject(new Error('A IA demorou demais para consolidar.'));
      }, TURN_MS);
      timer.unref?.();
      waiters.set(chat.id, { resolve, reject, timer });
      Promise.resolve()
        .then(() => send(ctx, { chatId: chat.id, text }))
        .catch((e) => {
          clearTimeout(timer);
          waiters.delete(chat.id);
          reject(e);
        });
    });
  }
  function onChatDone({ chatId, status }) {
    const w = waiters.get(chatId);
    if (!w) return;
    waiters.delete(chatId);
    clearTimeout(w.timer);
    const reply = [...(chatOf(chatId)?.messages || [])].reverse().find((m) => m.role === 'assistant');
    if (status === 'done' && reply?.text) w.resolve(reply.text);
    else w.reject(new Error(reply?.error || 'A consolidação foi interrompida.'));
  }
  function dropChat(id) {
    const chats = state().chats;
    const i = chats.findIndex((c) => c.id === id);
    if (i >= 0) chats.splice(i, 1);
  }

  // ---- Running ----------------------------------------------------------------------------------------------------
  async function consolidateBatch(batch, run) {
    const project = batch.projectId ? state().projects.find((p) => p.id === batch.projectId) : null;
    const chat = store.addChat({
      provider: run.provider,
      model: cfg().model,
      projectId: null,
      mode: 'read',
      memory: false,
    });
    chat.title = 'Consolidar memória';
    chat.memoryConsolidation = run.id;
    chat.skills = false;
    let reply;
    try {
      reply = await turn(chat, C.buildConsolidationPrompt({ projectName: project?.name, ...batch }));
    } finally {
      dropChat(chat.id);
    }
    const done = new Set(batch.stretches.map((s) => s.item.sessionId));
    // A conversation deleted while the AI worked: its content must not outlive it, so this answer is dropped whole.
    if (batch.stretches.some((s) => !chatOf(s.item.chatId))) {
      state().memoryToConsolidate = waiting().filter((i) => !done.has(i.sessionId));
      return commit();
    }
    const { pages, sessions, removed } = C.parseConsolidationReply(reply, {
      sessionIds: [...done],
      pages: batch.pages,
    });
    const sc = scope(batch.projectId);
    const notes = [];
    for (const p of [...pages, ...sessions]) {
      await ctx.memory.call('memory_write_page', {
        path: p.path,
        body: '# ' + p.title + '\n\n' + p.body,
        tier: p.kind === 'session' ? 'episodic' : 'semantic',
        tags: ['vesta', p.kind],
        ...sc,
      });
      const chatId = p.sessionId ? batch.stretches.find((s) => s.item.sessionId === p.sessionId)?.item.chatId : null;
      notes.push({
        id: randomUUID(),
        path: p.path,
        title: p.title,
        kind: p.kind,
        projectId: batch.projectId,
        chatId: chatId || null,
        body: p.body,
        createdAt: now(),
      });
    }
    // Merged or redundant memories go from the server (a page it no longer has is simply gone) and from the screen.
    for (const path of removed) await ctx.memory.call('memory_delete_page', { path, ...sc }).catch(() => {});
    const key = (n) => (n.projectId || '') + '|' + n.path;
    const gone = new Set([...notes.map(key), ...removed.map((path) => key({ projectId: batch.projectId, path }))]);
    state().memories = [...notes, ...state().memories.filter((n) => !gone.has(key(n)))];
    state().memoryToConsolidate = waiting().filter((i) => !done.has(i.sessionId));
    if (batch.pages.length) cfg().compactedAt[batch.projectId || ''] = now();
    run.pages += notes.length;
    run.removed += removed.length;
    commit();
  }
  // Since the last pass over a project's memories, did any of them change? (a scheduled run skips the others)
  const changed = (projectId) => {
    const since = cfg().compactedAt[projectId || ''] || 0;
    return state().memories.some(
      (n) => (n.projectId || null) === projectId && C.fromConversations(n) && (n.updatedAt || n.createdAt || 0) > since
    );
  };
  // Takes everything waiting and the memories to merge; one batch (one project) at a time. The first failure stops the
  // run: the rest waits for the next one, and a stretch that failed 3 times is given up.
  function run(trigger) {
    if (current) throw new UserError('A consolidação já está rodando');
    const c = cfg();
    state().memoryToConsolidate = waiting().filter((i) => chatOf(i.chatId));
    const batches = C.batchesOf(waiting(), chatOf, {
      memories: state().memories,
      compact: trigger === 'manual' ? () => true : changed,
    });
    if (!batches.length) {
      if (trigger === 'manual')
        throw new UserError('Nada para consolidar: nenhuma conversa esperando nem memórias de conversas para juntar');
      return null;
    }
    if (!installed(c.provider)) throw new UserError('A IA escolhida não está instalada (tela Conexões)');
    const r = {
      id: randomUUID(),
      at: now(),
      endedAt: null,
      trigger,
      provider: c.provider,
      status: 'running',
      stretches: batches.reduce((n, b) => n + b.stretches.length, 0),
      reviewed: batches.reduce((n, b) => n + b.pages.length, 0),
      pages: 0,
      removed: 0,
      error: '',
    };
    c.runs = [r, ...c.runs].slice(0, MAX_RUNS);
    commit();
    current = (async () => {
      for (const batch of batches)
        try {
          await consolidateBatch(batch, r);
        } catch (e) {
          for (const s of batch.stretches) s.item.attempts = (s.item.attempts || 0) + 1;
          state().memoryToConsolidate = waiting().filter((i) => (i.attempts || 0) < MAX_ATTEMPTS);
          return Object.assign(r, { status: 'error', error: redact(String(e.message || e)).slice(0, 400) });
        }
      r.status = 'ok';
    })().finally(() => {
      r.endedAt = now();
      current = null;
      commit();
    });
    return r.id;
  }
  const runNow = () => ({ runId: run('manual') });
  // Resolves when the running consolidation (if any) is over (tests).
  const idle = () => current || Promise.resolve();

  // ---- Clock ------------------------------------------------------------------------------------------------------
  function tick() {
    const c = cfg();
    if (current || !c.nextRunAt || c.nextRunAt > now() || !probed(c.provider)) return;
    schedule();
    try {
      if (!run('schedule')) commit();
    } catch (e) {
      const t = now();
      c.runs = [
        {
          id: randomUUID(),
          at: t,
          endedAt: t,
          trigger: 'schedule',
          provider: c.provider,
          status: 'error',
          stretches: 0,
          reviewed: 0,
          removed: 0,
          pages: 0,
          error: e.message,
        },
        ...c.runs,
      ].slice(0, MAX_RUNS);
      commit();
    }
  }
  // At start: hidden chats and runs left by the previous session are closed; a time missed while VeSTA was closed runs
  // at the first tick.
  function recover() {
    state().consolidation = normalizeConfig(state().consolidation);
    const chats = state().chats;
    for (let i = chats.length - 1; i >= 0; i--) if (chats[i].memoryConsolidation) chats.splice(i, 1);
    for (const r of cfg().runs)
      if (r.status === 'running')
        Object.assign(r, { status: 'error', endedAt: now(), error: 'O VeSTA fechou durante a consolidação.' });
    if (!cfg().nextRunAt) schedule();
  }
  let timer = null;
  // VESTA_CONSOLIDATION_TICK_MS only shortens the 1 min clock for the E2E tests.
  function startClock() {
    recover();
    timer = (deps.setInterval || setInterval)(tick, Number(process.env.VESTA_CONSOLIDATION_TICK_MS) || TICK_MS);
    timer?.unref?.();
  }
  function stopClock() {
    if (timer) (deps.clearInterval || clearInterval)(timer);
    timer = null;
  }

  return { enqueue, forgetChat, configure, runNow, onChatDone, tick, recover, idle, startClock, stopClock };
}

module.exports = { createConsolidator, normalizeConfig, TICK_MS };
