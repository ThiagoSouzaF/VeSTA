import { runningCounts, activityGroups } from './activity.js';

// Global state of the mascot (Vesta). Pure: no React, no clock of its own, shared by the desktop and the phone.
//   scan(data, groups)      -> facts that do not depend on time (memoize on the identity of data.chats/running/quests)
//   resolve(facts, now, o)  -> { state, phrase, count, title }
//   nextChangeAt(facts, now, o) -> when `resolve` may answer something else with no new data (timers)
// States, in priority order:
//   error     a turn or quest step failed in the last ERROR_MS
//   thinking  a permission request waits for an answer (wins over working: the AI is blocked on the person)
//   working   tasks / tools / subagents running, or an AI already answering
//   thinking  an AI is running but has not produced text or tools yet
//   success   something finished well in the last SUCCESS_MS and nothing runs
//   sleeping  nothing ran for SLEEP_MS, or it is night (0h-6h) and nothing happened for NIGHT_QUIET_MS
//   idle      everything else
export const ERROR_MS = 20_000;
export const SUCCESS_MS = 6_000;
export const SLEEP_MS = 15 * 60_000;
export const NIGHT_QUIET_MS = 60_000;
export const NIGHT = [0, 6]; // local hours [from, to)

export const STATES = ['idle', 'thinking', 'working', 'success', 'error', 'sleeping'];
export const STATE_LABEL = {
  idle: 'Pronta',
  thinking: 'Pensando',
  working: 'Trabalhando',
  success: 'Concluído',
  error: 'Com problema',
  sleeping: 'Descansando',
};

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const clip = (s, n = 30) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ---- facts ------------------------------------------------------------------------------------------------------
const chatCache = new WeakMap(); // chat -> facts of that chat (a text delta only replaces the chat it touched)
function chatFacts(chat) {
  let f = chatCache.get(chat);
  if (f) return f;
  const msgs = chat.messages,
    last = msgs[msgs.length - 1];
  let pending = 0;
  for (let i = msgs.length - 1; i >= 0 && i >= msgs.length - 2; i--)
    for (const p of msgs[i].permissions || []) if (p.status === 'pending') pending++;
  const asst = last && last.role === 'assistant' ? last : null;
  f = {
    pending,
    // The turn is already answering: it has text, tools or subagents.
    output: !!(asst && (asst.text || asst.activities?.length || asst.subagents?.length)),
    endedAt: asst?.endedAt || asst?.createdAt || 0,
    status: asst?.status || null,
    lastAt: Math.max(chat.updatedAt || 0, last?.endedAt || last?.createdAt || 0),
  };
  chatCache.set(chat, f);
  return f;
}

// `groups` (activityGroups) is optional: the desktop already has it memoized.
export function scan({ chats = [], running = [], quests = [] } = {}, groups) {
  groups ||= activityGroups(chats, running);
  const live = new Set(running);
  const facts = {
    pending: 0,
    liveChats: 0,
    thinkingChats: 0,
    tasks: runningCounts(groups).total,
    error: null, // { at, title }
    success: null, // { at }
    lastAt: 0, // newest moment anything happened (finished or started)
  };
  const fail = (at, title) => {
    if (at && (!facts.error || at > facts.error.at)) facts.error = { at, title };
  };
  const ok = (at) => {
    if (at && (!facts.success || at > facts.success.at)) facts.success = { at };
  };
  for (const c of chats) {
    const f = chatFacts(c);
    facts.pending += f.pending;
    facts.lastAt = Math.max(facts.lastAt, f.lastAt);
    if (live.has(c.id)) {
      facts.liveChats++;
      if (!f.output) facts.thinkingChats++;
    } else if (f.status === 'error') fail(f.endedAt, c.title);
    else if (f.status === 'done') ok(f.endedAt);
  }
  for (const q of quests) {
    facts.lastAt = Math.max(facts.lastAt, q.updatedAt || 0);
    for (const s of q.steps || []) {
      if (s.status === 'error') fail(s.endedAt, q.title);
      facts.lastAt = Math.max(facts.lastAt, s.endedAt || s.startedAt || 0);
    }
    if (q.status === 'done') ok(q.updatedAt);
  }
  return facts;
}

// ---- state ------------------------------------------------------------------------------------------------------
const isNight = (now) => {
  const h = new Date(now).getHours();
  return h >= NIGHT[0] && h < NIGHT[1];
};
const busy = (f) => f.pending > 0 || f.liveChats > 0 || f.tasks > 0;

// o: { online = true, awakeSince = 0 }. `awakeSince` = when the app opened: opening it counts as being awake.
export function resolve(f, now, { online = true, awakeSince = 0 } = {}) {
  if (!online) return { state: 'sleeping', phrase: 'Sem conexão com o computador', count: 0, title: '' };
  if (f.error && now - f.error.at < ERROR_MS)
    return {
      state: 'error',
      phrase: 'Algo deu errado em ' + clip(f.error.title || 'um chat'),
      count: 1,
      title: f.error.title,
    };
  if (f.pending > 0)
    return {
      state: 'thinking',
      phrase: f.pending === 1 ? 'Aguardando a sua permissão' : f.pending + ' pedidos aguardando permissão',
      count: f.pending,
      title: '',
    };
  if (f.tasks > 0)
    return {
      state: 'working',
      phrase: plural(f.tasks, 'tarefa em andamento', 'tarefas em andamento'),
      count: f.tasks,
      title: '',
    };
  if (f.liveChats > f.thinkingChats)
    return { state: 'working', phrase: 'Escrevendo a resposta…', count: f.liveChats - f.thinkingChats, title: '' };
  if (f.thinkingChats > 0)
    return { state: 'thinking', phrase: 'Pensando no seu pedido…', count: f.thinkingChats, title: '' };
  if (f.success && now - f.success.at < SUCCESS_MS)
    return { state: 'success', phrase: 'Tudo pronto!', count: 1, title: '' };
  const last = Math.max(f.lastAt, awakeSince);
  if (now - last >= SLEEP_MS || (isNight(now) && now - last >= NIGHT_QUIET_MS))
    return { state: 'sleeping', phrase: 'Descansando — chame quando precisar', count: 0, title: '' };
  return { state: 'idle', phrase: 'Tudo calmo por aqui', count: 0, title: '' };
}

// Next instant (ms epoch) at which the answer can change by itself, or Infinity.
export function nextChangeAt(f, now, { online = true, awakeSince = 0 } = {}) {
  if (!online) return Infinity;
  const c = [];
  if (f.error) c.push(f.error.at + ERROR_MS);
  if (f.success) c.push(f.success.at + SUCCESS_MS);
  if (!busy(f)) {
    const last = Math.max(f.lastAt, awakeSince);
    c.push(last + SLEEP_MS, last + NIGHT_QUIET_MS);
    const d = new Date(now); // the night begins/ends on a whole hour
    for (const h of NIGHT) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime();
      c.push(t > now ? t : t + 86_400_000);
    }
  }
  return Math.min(...c.filter((t) => t > now), Infinity);
}

export const mascotState = (data, now, opts, groups) => resolve(scan(data, groups), now, opts);
