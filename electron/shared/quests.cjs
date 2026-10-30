// Quests: several AIs working together on one goal. Pure functions, no I/O: used by the engine (main process), the
// tests and the renderer (the board derives from the same file).
//
// Quest { id, title, goal, guidelines, projectId, status, maxParallel, steps[], log[], summary, pauseReason, planning, leadChatId,
//         createdAt, updatedAt }
//   leadChatId  the quest's own chat: it receives the idea (the planning turn) and later briefs the person on every step
//   status  'draft' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
// Step { id, title, instructions, provider, model, mode, dependsOn[], kind, status, chatId, result, startedAt, endedAt, attempts }
//   kind    'work' | 'review'          status  'pending' | 'running' | 'done' | 'error' | 'skipped'
// Message meant for the person (see errors.cjs; this file also runs in the renderers, so it cannot require it).
const userError = (message) => Object.assign(new Error(message), { name: 'UserError', userSafe: true });
const QUEST_STATUS = ['draft', 'running', 'paused', 'done', 'failed', 'cancelled'];
const STEP_STATUS = ['pending', 'running', 'done', 'error', 'skipped'];
const MODES = ['edit', 'read', 'ask'];
const PROVIDER_IDS = ['claude', 'codex', 'opencode', 'drael'];
const MAX_STEPS = 12;
const MAX_LOG = 200;
const MAX_RESULT = 1500;
// Step status as the person reads it (refusals, the quest chat brief).
const STATUS_PT = { pending: 'pendente', running: 'rodando', done: 'feita', error: 'com problema', skipped: 'pulada' };
const STRENGTHS = {
  claude: 'raciocínio profundo, refatoração, revisão de código e textos claros',
  codex: 'implementação rápida de código, testes e correções pontuais',
  opencode: 'tarefas gerais de código e automação com o modelo configurado no OpenCode',
  drael: 'consulta e análise com o harness nativo Drael (somente leitura/consulta)',
};

const text = (v, max) =>
  String(v ?? '')
    .replace(/\r\n/g, '\n')
    .slice(0, max)
    .trim();
const clampParallel = (n) => Math.min(6, Math.max(1, Math.round(Number(n)) || 2));

function normalizeStep(raw, i = 0) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const provider = PROVIDER_IDS.includes(s.provider) ? s.provider : 'claude';
  const kind = s.kind === 'review' ? 'review' : 'work';
  let mode = MODES.includes(s.mode) ? s.mode : kind === 'review' ? 'read' : 'edit';
  if (provider === 'drael' && mode === 'ask') mode = 'read';
  const status = STEP_STATUS.includes(s.status) ? s.status : 'pending';
  return {
    id: text(s.id, 40) || 's' + (i + 1),
    title: text(s.title, 120) || 'Etapa ' + (i + 1),
    instructions: text(s.instructions, 8000),
    provider,
    model: text(s.model, 120),
    mode,
    dependsOn: Array.isArray(s.dependsOn) ? [...new Set(s.dependsOn.map((d) => text(d, 40)).filter(Boolean))] : [],
    kind,
    status,
    chatId: s.chatId ? String(s.chatId) : null,
    result: text(s.result, MAX_RESULT),
    startedAt: Number(s.startedAt) || null,
    endedAt: Number(s.endedAt) || null,
    attempts: Math.max(0, Number(s.attempts) || 0),
  };
}

// Makes a list of steps consistent: unique ids, dependencies that exist and never point to the step itself.
function normalizeSteps(list) {
  const out = [],
    seen = new Set();
  for (const raw of Array.isArray(list) ? list.slice(0, MAX_STEPS) : []) {
    const s = normalizeStep(raw, out.length);
    while (seen.has(s.id)) s.id += '_';
    seen.add(s.id);
    out.push(s);
  }
  for (const s of out) s.dependsOn = s.dependsOn.filter((d) => d !== s.id && seen.has(d));
  return out;
}

// Store migration: any stored quest becomes a well-formed one (defaults for whatever is missing).
function normalizeQuest(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const now = Date.now();
  return {
    id: String(q.id || 'q' + now.toString(36) + Math.random().toString(36).slice(2, 6)),
    title: text(q.title, 120) || 'Quest',
    goal: text(q.goal, 8000),
    guidelines: text(q.guidelines, 8000),
    projectId: q.projectId || null,
    status: QUEST_STATUS.includes(q.status) ? q.status : 'draft',
    maxParallel: clampParallel(q.maxParallel),
    steps: normalizeSteps(q.steps),
    log: (Array.isArray(q.log) ? q.log : [])
      .filter((e) => e && e.text)
      .slice(-MAX_LOG)
      .map((e) => ({ at: Number(e.at) || now, text: text(e.text, 400) })),
    summary: text(q.summary, 6000),
    pauseReason: q.pauseReason === 'error' || q.pauseReason === 'user' ? q.pauseReason : null,
    planning: q.planning && typeof q.planning === 'object' ? { ...q.planning } : null,
    leadChatId: q.leadChatId ? String(q.leadChatId) : null,
    createdAt: Number(q.createdAt) || now,
    updatedAt: Number(q.updatedAt) || now,
  };
}
const normalizeQuests = (list) => (Array.isArray(list) ? list.map(normalizeQuest) : []);

function touch(q, now = Date.now()) {
  q.updatedAt = now;
  return q;
}
function addLog(q, msg, now = Date.now()) {
  q.log.push({ at: now, text: text(msg, 400) });
  if (q.log.length > MAX_LOG) q.log.splice(0, q.log.length - MAX_LOG);
  touch(q, now);
}
const step = (q, id) => q.steps.find((s) => s.id === id);

// ---- Graph -------------------------------------------------------------------------------------------------------
// Ids that are part of, or depend on, a cycle (empty when the graph is acyclic).
function cycleIds(steps) {
  const deps = new Map(steps.map((s) => [s.id, s.dependsOn.filter((d) => steps.some((x) => x.id === d))]));
  const indegree = new Map([...deps].map(([id, d]) => [id, d.length]));
  const queue = [...indegree].filter(([, n]) => n === 0).map(([id]) => id);
  const done = new Set();
  while (queue.length) {
    const id = queue.shift();
    done.add(id);
    for (const [other, d] of deps)
      if (d.includes(id)) {
        indegree.set(other, indegree.get(other) - 1);
        if (indegree.get(other) === 0) queue.push(other);
      }
  }
  return steps.filter((s) => !done.has(s.id)).map((s) => s.id);
}
// Stable topological order: dependencies first, otherwise the original order. Assumes no cycle.
function topoSort(steps) {
  const out = [],
    placed = new Set(),
    pending = [...steps];
  while (pending.length) {
    const i = pending.findIndex((s) => s.dependsOn.every((d) => placed.has(d) || !steps.some((x) => x.id === d)));
    const [s] = pending.splice(i < 0 ? 0 : i, 1);
    placed.add(s.id);
    out.push(s);
  }
  return out;
}
// Reports why a list of steps cannot run (null = fine). Used when the user edits the plan.
function validateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return 'Adicione ao menos uma etapa.';
  if (steps.length > MAX_STEPS) return 'No máximo ' + MAX_STEPS + ' etapas.';
  const ids = new Set(steps.map((s) => s.id));
  if (ids.size !== steps.length) return 'Há etapas com o mesmo identificador.';
  for (const s of steps) {
    if (!s.title.trim()) return 'Toda etapa precisa de um título.';
    if (!s.instructions.trim()) return 'A etapa "' + s.title + '" precisa de instruções.';
    for (const d of s.dependsOn)
      if (!ids.has(d)) return 'A etapa "' + s.title + '" depende de uma etapa que não existe.';
  }
  const cyc = cycleIds(steps);
  if (cyc.length) return 'As dependências formam um ciclo (' + cyc.join(', ') + ').';
  return null;
}

// ---- Scheduler ---------------------------------------------------------------------------------------------------
const satisfied = (s) => s.status === 'done' || s.status === 'skipped';
const isReady = (q, s) =>
  s.status === 'pending' && s.dependsOn.every((d) => satisfied(step(q, d) || { status: 'done' }));
// Steps to start now: dependencies finished, within the free parallel slots. Nothing while the quest is not running.
function readySteps(q) {
  if (q.status !== 'running') return [];
  const free = q.maxParallel - q.steps.filter((s) => s.status === 'running').length;
  return free > 0 ? q.steps.filter((s) => isReady(q, s)).slice(0, free) : [];
}
// Settles the quest after any change: finished -> done; nothing can advance because of an error -> paused.
function evaluate(q, now = Date.now()) {
  if (q.status !== 'running') return q;
  const open = q.steps.filter((s) => s.status === 'pending' || s.status === 'running');
  const errors = q.steps.some((s) => s.status === 'error');
  if (!open.length && !errors && q.steps.length) {
    q.status = 'done';
    q.pauseReason = null;
    q.summary = buildSummary(q);
    addLog(q, 'Quest concluída.', now);
  } else if (!q.steps.some((s) => s.status === 'running') && !readySteps(q).length && (errors || open.length)) {
    q.status = 'paused';
    q.pauseReason = 'error';
    addLog(q, 'Pausada: nenhuma etapa pode avançar. Tente de novo ou pule a etapa com problema.', now);
  }
  return touch(q, now);
}
function buildSummary(q) {
  const done = q.steps.filter((s) => s.status === 'done').length,
    skipped = q.steps.filter((s) => s.status === 'skipped').length;
  const head =
    'Quest "' +
    q.title +
    '" concluída: ' +
    done +
    ' etapa(s) feita(s)' +
    (skipped ? ', ' + skipped + ' pulada(s)' : '') +
    '.';
  const body = q.steps
    .filter((s) => s.status === 'done')
    .map((s) => '- ' + s.title + ' (' + s.provider + '): ' + (s.result || '').replace(/\s+/g, ' ').slice(0, 220))
    .join('\n');
  return head + (body ? '\n' + body : '');
}

// ---- Transitions (mutate the quest, no I/O) ----------------------------------------------------------------------
function start(q, now = Date.now()) {
  if (q.status !== 'draft') throw userError('Esta quest já foi iniciada');
  const err = validateSteps(q.steps);
  if (err) throw userError(err);
  q.status = 'running';
  q.pauseReason = null;
  addLog(q, 'Quest iniciada.', now);
  return q;
}
function pause(q, now = Date.now()) {
  if (q.status !== 'running') throw userError('A quest não está rodando');
  q.status = 'paused';
  q.pauseReason = 'user';
  addLog(q, 'Pausada. As etapas em curso terminam; nenhuma nova começa.', now);
  return q;
}
function resume(q, now = Date.now()) {
  if (q.status !== 'paused') throw userError('A quest não está pausada');
  q.status = 'running';
  q.pauseReason = null;
  addLog(q, 'Retomada.', now);
  return q;
}
// Returns the chat ids that must be stopped.
function cancel(q, now = Date.now()) {
  if (q.status === 'done' || q.status === 'cancelled') throw userError('A quest já terminou');
  const chats = [];
  for (const s of q.steps)
    if (s.status === 'running') {
      if (s.chatId) chats.push(s.chatId);
      s.status = 'skipped';
      s.endedAt = now;
      s.result = s.result || 'Cancelada.';
    }
  q.status = 'cancelled';
  q.pauseReason = null;
  addLog(q, 'Cancelada.', now);
  return chats;
}
function beginStep(q, id, chatId, now = Date.now()) {
  const s = step(q, id);
  s.status = 'running';
  s.chatId = chatId;
  s.startedAt = now;
  s.endedAt = null;
  s.attempts += 1;
  addLog(q, 'Começou: ' + s.title + ' (' + s.provider + ').', now);
  return s;
}
function finishStep(q, id, result, now = Date.now()) {
  const s = step(q, id);
  s.status = 'done';
  s.result = text(result, MAX_RESULT);
  s.endedAt = now;
  addLog(q, 'Concluiu: ' + s.title + '.', now);
  return s;
}
// A failed step pauses the quest: the user decides between retrying and skipping. Running steps keep going.
function failStep(q, id, reason, now = Date.now()) {
  const s = step(q, id);
  s.status = 'error';
  s.result = text(reason, 600);
  s.endedAt = now;
  addLog(q, 'Erro em "' + s.title + '": ' + text(reason, 200), now);
  if (q.status === 'running') {
    q.status = 'paused';
    q.pauseReason = 'error';
  }
  return s;
}
function unblock(q, now) {
  if (q.status === 'paused' && q.pauseReason === 'error' && !q.steps.some((s) => s.status === 'error')) {
    q.status = 'running';
    q.pauseReason = null;
    addLog(q, 'Retomada automaticamente.', now);
  }
}
function retryStep(q, id, now = Date.now()) {
  const s = step(q, id);
  if (!s || s.status !== 'error') throw userError('Só dá para tentar de novo uma etapa com problema');
  s.status = 'pending';
  s.chatId = null;
  s.result = '';
  s.endedAt = null;
  addLog(q, 'Nova tentativa: ' + s.title + '.', now);
  unblock(q, now);
  return s;
}
function skipStep(q, id, now = Date.now()) {
  const s = step(q, id);
  if (!s || !(s.status === 'error' || s.status === 'pending'))
    throw userError('Só dá para pular uma etapa pendente ou com problema');
  s.status = 'skipped';
  s.endedAt = now;
  addLog(q, 'Pulou: ' + s.title + '.', now);
  unblock(q, now);
  return s;
}
// ---- Plan edits while the quest lives ----------------------------------------------------------------------------
// Pure: validate everything first, mutate last. `installed` = { provider: { models? } } of the usable AIs. `by`
// (optional) names who asked (the quest chat); it only shows in the journal.
const via = (by) => (by ? ' (' + by + ')' : '');
function editable(q) {
  if (q.status === 'done' || q.status === 'cancelled' || q.status === 'failed')
    throw userError('Esta quest já terminou: o plano não pode mais ser editado');
}
function findStep(q, id) {
  const s = step(q, String(id ?? ''));
  if (!s) throw userError('Etapa não encontrada nesta quest: ' + id);
  return s;
}
const STEP_REFUSAL = {
  running: 'está rodando: pare o chat da etapa (ou espere terminar) antes de mudá-la',
  done: 'já foi concluída e não pode mais ser alterada',
  skipped: 'foi pulada e não pode mais ser alterada',
};
function checkProvider(provider, installed) {
  if (!PROVIDER_IDS.includes(provider)) throw userError('IA desconhecida: ' + provider);
  if (!installed[provider]) throw userError(provider + ' não está instalada. Confira as Conexões.');
}
function checkModel(provider, model, installed) {
  const models = installed[provider]?.models;
  // Claude also takes aliases (haiku, sonnet...) and full ids that are not in the list the app knows.
  if (provider === 'claude' && /^(haiku|sonnet|opus|fable|claude-[\w.-]+)$/i.test(model)) return;
  if (model && Array.isArray(models) && models.length && !models.includes(model))
    throw userError(
      'Modelo "' + model + '" não existe em ' + provider + ' (disponíveis: ' + models.slice(0, 8).join(', ') + ')'
    );
}
function checkMode(provider, mode) {
  if (!MODES.includes(mode)) throw userError('Modo inválido: ' + mode + ' (use edit, read ou ask)');
  if (provider === 'drael' && mode === 'ask') throw userError('O Drael não aceita o modo ask; use read ou edit');
}
// Changes AI / model / mode / title / instructions / dependencies of a step that has not started (or failed).
// Everything else on the step (id, chat, result, attempts, times) and every other step stay as they are; a failed
// step that changes AI forgets its chat, so the next attempt opens a fresh one with the new AI.
function updateStep(q, id, patch = {}, installed = {}, now = Date.now(), by = '') {
  editable(q);
  const s = findStep(q, id);
  if (STEP_REFUSAL[s.status]) throw userError('A etapa "' + s.title + '" ' + STEP_REFUSAL[s.status]);
  const has = (k) => patch[k] !== undefined && patch[k] !== null;
  const provider = has('provider') ? String(patch.provider).toLowerCase() : s.provider;
  const providerChanged = provider !== s.provider;
  if (has('provider')) checkProvider(provider, installed);
  let model = has('model') ? text(patch.model, 120) : providerChanged ? '' : s.model;
  if (provider === 'drael') model = '';
  checkModel(provider, model, installed);
  const mode = has('mode') ? String(patch.mode) : s.mode;
  if (has('mode')) checkMode(provider, mode);
  const title = has('title') ? text(patch.title, 120) : s.title;
  const instructions = has('instructions') ? text(patch.instructions, 8000) : s.instructions;
  if (!title) throw userError('A etapa precisa de um título');
  if (!instructions) throw userError('A etapa precisa de instruções');
  let dependsOn = s.dependsOn;
  if (has('dependsOn')) {
    if (!Array.isArray(patch.dependsOn)) throw userError('dependsOn deve ser uma lista de ids de etapas');
    dependsOn = [...new Set(patch.dependsOn.map((d) => String(d)))];
    for (const d of dependsOn) {
      if (d === s.id) throw userError('Uma etapa não pode depender dela mesma');
      if (!step(q, d)) throw userError('A etapa depende de "' + d + '", que não existe');
    }
  }
  const next = normalizeStep({ ...s, provider, model, mode, title, instructions, dependsOn });
  const cyc = cycleIds(q.steps.map((x) => (x.id === s.id ? next : x)));
  if (cyc.length) throw userError('As dependências formariam um ciclo (' + cyc.join(', ') + ')');
  const changes = [];
  if (next.provider !== s.provider) changes.push('IA ' + s.provider + ' → ' + next.provider);
  if (next.model !== s.model) changes.push('modelo ' + (s.model || 'padrão') + ' → ' + (next.model || 'padrão'));
  if (next.mode !== s.mode) changes.push('modo ' + s.mode + ' → ' + next.mode);
  if (next.title !== s.title) changes.push('título "' + next.title + '"');
  if (next.instructions !== s.instructions) changes.push('instruções');
  if (next.dependsOn.join() !== s.dependsOn.join())
    changes.push('dependências: ' + (next.dependsOn.join(', ') || 'nenhuma'));
  if (!changes.length) return { step: s, changes };
  const oldTitle = s.title;
  Object.assign(s, {
    provider: next.provider,
    model: next.model,
    mode: next.mode,
    title: next.title,
    instructions: next.instructions,
    dependsOn: next.dependsOn,
  });
  if (s.status === 'error' && providerChanged) s.chatId = null;
  addLog(q, 'Etapa "' + oldTitle + '" alterada' + via(by) + ': ' + changes.join('; ') + '.', now);
  return { step: s, changes };
}
// Appends a pending step to a live plan. Dependencies must exist (no cycle is possible: nobody depends on it yet).
function addStep(q, input = {}, installed = {}, now = Date.now(), by = '') {
  editable(q);
  if (q.steps.length >= MAX_STEPS) throw userError('No máximo ' + MAX_STEPS + ' etapas.');
  const provider = String(input.provider || PROVIDER_IDS.find((p) => installed[p]) || '').toLowerCase();
  checkProvider(provider, installed);
  const model = provider === 'drael' ? '' : text(input.model, 120);
  checkModel(provider, model, installed);
  if (input.mode !== undefined) checkMode(provider, String(input.mode));
  const deps = input.dependsOn === undefined ? [] : input.dependsOn;
  if (!Array.isArray(deps)) throw userError('dependsOn deve ser uma lista de ids de etapas');
  for (const d of deps) if (!step(q, String(d))) throw userError('A etapa depende de "' + d + '", que não existe');
  let n = q.steps.length + 1;
  while (step(q, 's' + n)) n++;
  const s = normalizeStep(
    {
      ...input,
      id: 's' + n,
      provider,
      model,
      dependsOn: deps.map(String),
      status: 'pending',
      chatId: null,
      result: '',
      startedAt: null,
      endedAt: null,
      attempts: 0,
    },
    q.steps.length
  );
  const err = validateSteps([...q.steps, s]);
  if (err) throw userError(err);
  q.steps.push(s);
  addLog(q, 'Etapa adicionada' + via(by) + ': "' + s.title + '" (' + s.provider + ').', now);
  return s;
}
// Removes a pending step. Steps that waited for it inherit its own dependencies, so nothing is left dangling.
function removeStep(q, id, now = Date.now(), by = '') {
  editable(q);
  const s = findStep(q, id);
  if (s.status !== 'pending')
    throw userError(
      'Só dá para remover etapas pendentes; "' +
        s.title +
        '" está ' +
        STATUS_PT[s.status] +
        (s.status === 'error' ? ' (pule-a)' : '')
    );
  if (q.steps.length <= 1) throw userError('A quest precisa ter ao menos uma etapa');
  q.steps = q.steps.filter((x) => x.id !== s.id);
  for (const x of q.steps)
    if (x.dependsOn.includes(s.id))
      x.dependsOn = [...new Set([...x.dependsOn.filter((d) => d !== s.id), ...s.dependsOn])].filter((d) => d !== x.id);
  const err = validateSteps(q.steps);
  if (err) throw userError(err);
  addLog(q, 'Etapa removida' + via(by) + ': "' + s.title + '".', now);
  return s;
}
// App reopened (or a chat vanished): steps "running" whose chat is not running any more become errors; a planner
// that was running is marked failed. `runningChats` = ids of chats with a live job. Returns true when anything changed.
function reconcile(q, runningChats = [], now = Date.now()) {
  let changed = false;
  const live = new Set(runningChats);
  for (const s of q.steps)
    if (s.status === 'running' && !live.has(s.chatId)) {
      failStep(q, s.id, 'A etapa foi interrompida (o aplicativo foi fechado).', now);
      changed = true;
    }
  if (q.planning?.status === 'running' && !live.has(q.planning.chatId)) {
    q.planning = { ...q.planning, status: 'error', error: 'O planejamento foi interrompido.' };
    addLog(q, 'O planejamento foi interrompido.', now);
    changed = true;
  }
  // Nothing is scheduled while the app is closed: a quest left "running" waits for the user to resume it.
  if (q.status === 'running') {
    q.status = 'paused';
    q.pauseReason = q.pauseReason === 'error' || changed ? 'error' : 'user';
    addLog(q, 'O aplicativo foi reaberto: retome a quest quando quiser.', now);
    changed = true;
  }
  return changed;
}

// ---- View helpers (renderer) -------------------------------------------------------------------------------------
function progress(q) {
  const total = q.steps.length,
    done = q.steps.filter(satisfied).length;
  return {
    total,
    done,
    running: q.steps.filter((s) => s.status === 'running').length,
    errors: q.steps.filter((s) => s.status === 'error').length,
    pct: total ? Math.round((done / total) * 100) : 0,
    providers: [...new Set(q.steps.map((s) => s.provider))],
  };
}
// Board columns -> step ids, in plan order.
function columns(q) {
  const col = { pending: [], running: [], done: [], problems: [] };
  for (const s of q.steps)
    (s.status === 'pending'
      ? col.pending
      : s.status === 'running'
        ? col.running
        : s.status === 'error'
          ? col.problems
          : col.done
    ).push(s);
  return col;
}
module.exports = {
  MAX_RESULT,
  STATUS_PT,
  text,
  QUEST_STATUS,
  STEP_STATUS,
  MAX_STEPS,
  PROVIDER_IDS,
  STRENGTHS,
  normalizeStep,
  normalizeSteps,
  normalizeQuest,
  normalizeQuests,
  cycleIds,
  topoSort,
  validateSteps,
  readySteps,
  evaluate,
  buildSummary,
  start,
  pause,
  resume,
  cancel,
  beginStep,
  finishStep,
  failStep,
  retryStep,
  skipStep,
  updateStep,
  addStep,
  removeStep,
  reconcile,
  progress,
  columns,
  addLog,
  touch,
  step,
};
