// Unified task model. Pure functions, no I/O: used by the main process (settling a message, limits) and by the
// renderer (the Activity screen and the per-message summary import this same file).
//
// Task { id, chatId, messageId, provider, kind, label, detail, status, parentId, startedAt, endedAt, stats?, extra?, taskId? }
//   kind    'turn' | 'subagent' | 'command' | 'background' | 'monitor' | 'tool' | 'mcp' | 'file' | 'search' | 'web'
//   status  'running' | 'done' | 'error' | 'stopped'
// What the parsers store on an assistant message is the source: `activities[]`, `subagents[]` (with `steps[]`).
const KINDS = ['turn', 'subagent', 'command', 'background', 'monitor', 'tool', 'mcp', 'file', 'search', 'web'];
const MAX_ACTIVITIES = 400;
const MAX_STEPS = 200;

// Stored activity kind -> task kind. A background flag turns a command into a background task.
function activityKind(a) {
  if (a.kind === 'monitor') return 'monitor';
  if (a.background) return 'background';
  switch (a.kind) {
    case 'command':
    case 'file':
    case 'search':
    case 'web':
    case 'mcp':
      return a.kind;
    default:
      return 'tool';
  }
}
const normStatus = (s) => (s === 'running' || s === 'error' || s === 'stopped' ? s : 'done');
const finished = (s) => s !== 'running';

// Drops the oldest finished entries beyond `max` (running ones are never dropped). Returns how many were dropped.
function capList(list, max) {
  let excess = list.length - max;
  if (excess <= 0) return 0;
  let dropped = 0;
  for (let i = 0; i < list.length && excess > 0; ) {
    if (list[i].status === 'running') i++;
    else {
      list.splice(i, 1);
      excess--;
      dropped++;
    }
  }
  return dropped;
}
// Maps a CLI-reported status word (Claude: completed/failed/killed/stopped, Codex: failed/declined...) to ours.
function taskStatus(word) {
  const w = String(word || '').toLowerCase();
  if (['completed', 'complete', 'done', 'success', 'succeeded', 'shutdown'].includes(w)) return 'done';
  if (['killed', 'stopped', 'cancelled', 'canceled', 'interrupted', 'aborted'].includes(w)) return 'stopped';
  if (['failed', 'error', 'errored', 'declined', 'notfound'].includes(w)) return 'error';
  return 'running';
}

const turnStatus = (m) =>
  m.status === 'running' ? 'running' : m.status === 'cancelled' ? 'stopped' : m.status === 'error' ? 'error' : 'done';

// One assistant message -> flat list of tasks, turn first, parents before children.
function messageTasks(chat, m, { live = true } = {}) {
  // A message still marked running while nothing runs for its chat (the app closed mid-turn): it was interrupted.
  const stale = !live && m.status === 'running';
  const chatId = chat.id,
    provider = m.provider || chat.provider,
    base = m.createdAt || 0;
  const turnId = 'turn:' + m.id;
  const out = [];
  const make = (o) => ({
    chatId,
    messageId: m.id,
    provider,
    detail: '',
    parentId: turnId,
    endedAt: null,
    ...o,
  });
  const fix = (x) => (stale && x === 'running' ? 'stopped' : x);
  const children = [];
  const acts = m.activities || [];
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i],
      status = fix(normStatus(a.status));
    children.push(
      make({
        id: 'act:' + m.id + ':' + (a.id || i),
        kind: activityKind(a),
        label: a.title || a.label || 'Atividade',
        detail: a.detail || '',
        status,
        startedAt: a.startedAt || base,
        endedAt: finished(status) ? a.endedAt || a.startedAt || base : null,
        ...(a.taskId ? { taskId: a.taskId } : {}),
        ...(a.detached ? { stats: { detached: true } } : {}),
        ...(a.result ? { extra: { result: a.result } } : {}),
      })
    );
  }
  for (const s of m.subagents || []) {
    const status = fix(normStatus(s.status)),
      id = 'sub:' + m.id + ':' + s.toolUseId;
    children.push(
      make({
        id,
        kind: 'subagent',
        label: s.label || s.subagentType || 'Subagente',
        detail: s.subagentType || '',
        status,
        startedAt: s.startedAt || base,
        endedAt: finished(status) ? s.endedAt || s.startedAt || base : null,
        ...(s.taskId ? { taskId: s.taskId } : {}),
        stats: { ...s.stats, background: !!s.background, omitted: s.stepsDropped || 0, steps: (s.steps || []).length },
        extra: { prompt: s.prompt || '', result: s.result || '' },
      })
    );
    for (const st of s.steps || []) {
      const ss = fix(normStatus(st.status)),
        at = st.startedAt || st.at || s.startedAt || base;
      children.push(
        make({
          id: 'step:' + m.id + ':' + s.toolUseId + ':' + st.id,
          parentId: id,
          kind: activityKind(st),
          label: st.title || st.label || 'Etapa',
          detail: st.detail || '',
          status: ss,
          startedAt: at,
          endedAt: finished(ss) ? st.endedAt || at : null,
          ...(st.result ? { extra: { result: st.result } } : {}),
        })
      );
    }
  }
  const ts = stale ? 'stopped' : turnStatus(m);
  let end = m.endedAt || null;
  if (ts !== 'running' && !end) end = children.reduce((x, c) => Math.max(x, c.endedAt || 0), 0) || base;
  out.push({
    id: turnId,
    chatId,
    messageId: m.id,
    provider,
    kind: 'turn',
    label: 'Resposta',
    detail: (m.text || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    status: ts,
    parentId: null,
    startedAt: base,
    endedAt: ts === 'running' ? null : end,
    stats: { omitted: m.activitiesDropped || 0 },
  });
  out.push(...children);
  return out;
}

// Flat list -> nested nodes [{ task, children }] (roots first).
function buildTree(tasks) {
  const nodes = new Map(tasks.map((t) => [t.id, { task: t, children: [] }]));
  const roots = [];
  for (const t of tasks) {
    const n = nodes.get(t.id),
      p = t.parentId && nodes.get(t.parentId);
    if (p) p.children.push(n);
    else roots.push(n);
  }
  return roots;
}
const isDetached = (t) => !!t.stats?.detached;
// Counts that feed the summary lines. `running` ignores turns and detached background commands (nobody tracks them).
function countTasks(tasks) {
  const c = { total: 0, running: 0, subagents: 0, commands: 0, background: 0, tools: 0, detached: 0, turns: 0 };
  for (const t of tasks) {
    if (t.kind === 'turn') {
      c.turns++;
      continue;
    }
    c.total++;
    const live = t.status === 'running' && !isDetached(t);
    if (live) c.running++;
    if (t.status === 'running' && isDetached(t)) c.detached++;
    if (t.kind === 'subagent') c.subagents++;
    else if (t.kind === 'command') c.commands++;
    else if (t.kind === 'background' || t.kind === 'monitor') c.background++;
    else c.tools++;
  }
  return c;
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
// "3 subagentes · 5 comandos · 1 em segundo plano" (empty when there is nothing to say).
function summaryLine(counts) {
  const parts = [];
  if (counts.subagents) parts.push(plural(counts.subagents, 'subagente', 'subagentes'));
  if (counts.commands) parts.push(plural(counts.commands, 'comando', 'comandos'));
  if (counts.background) parts.push(counts.background + ' em segundo plano');
  if (counts.tools) parts.push(plural(counts.tools, 'ferramenta', 'ferramentas'));
  return parts.join(' · ');
}

// Closes everything still running when a turn ends. Background commands that outlive a finished turn keep running
// but are marked `detached`: the CLI that reported them is gone, so VeSTA no longer hears when they end.
function settleMessage(m, outcome, now = Date.now()) {
  const status = outcome === 'stopped' ? 'stopped' : outcome === 'error' ? 'error' : 'done';
  const close = (x) => {
    if (x.status !== 'running') return;
    if (status === 'done' && x.background && x.taskId && x.kind !== 'subagent') {
      x.detached = true;
      return;
    }
    x.status = status;
    x.endedAt = now;
  };
  for (const a of m.activities || []) close(a);
  for (const s of m.subagents || []) {
    if (s.status === 'running') {
      s.status = status;
      s.endedAt = now;
    }
    for (const st of s.steps || []) if (st.status === 'running') Object.assign(st, { status, endedAt: now });
  }
  m.endedAt = now;
}

module.exports = {
  KINDS,
  MAX_ACTIVITIES,
  MAX_STEPS,
  activityKind,
  capList,
  taskStatus,
  messageTasks,
  buildTree,
  countTasks,
  summaryLine,
  settleMessage,
  isDetached,
};
