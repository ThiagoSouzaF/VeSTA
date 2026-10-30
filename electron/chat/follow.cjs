// "Acompanhando": a Claude chat whose turn ended while commands/monitors it started in the background are still
// running. The claude.exe process stays alive with stdin open, so the CLI itself delivers the task_notification,
// starts a new turn and VeSTA shows it as a new assistant message. This file holds the pure rules (limits, texts)
// and the registry of chats being followed; the process handling is in drivers.cjs and send.cjs.
const DEFAULT_MINUTES = 120;
const DEFAULT_MAX_CHATS = 3;
const MIN_MINUTES = 5;
const MAX_MINUTES = 24 * 60;
const MAX_CHATS = 10;
// How long the CLI gets to start the turn after a task_notification before VeSTA nudges it with a short message.
const NUDGE_MS = 20000;

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
// Preferences -> limits in use.
function limits(settings = {}) {
  return {
    minutes: clampInt(settings.followMinutes, MIN_MINUTES, MAX_MINUTES, DEFAULT_MINUTES),
    maxChats: clampInt(settings.followMax, 1, MAX_CHATS, DEFAULT_MAX_CHATS),
  };
}
// May a turn that just ended keep its process for these background tasks? `count` = chats already followed.
function shouldFollow({ tasks, count, settings, enabled = true }) {
  if (!enabled || !tasks?.length) return false;
  return count < limits(settings).maxChats;
}
const deadlineOf = (since, settings) => since + limits(settings).minutes * 60000;
const expired = (follow, now = Date.now()) => now >= follow.deadline;

const names = (tasks) => (tasks || []).map((t) => t.description || t.taskId).filter(Boolean);
// The automatic message used only when the CLI does not start the turn by itself.
function nudgeText(finished) {
  const list = names(finished);
  return list.length
    ? 'O processo em segundo plano terminou (' +
        list.slice(0, 3).join('; ') +
        '). Verifique o resultado e me conte o que aconteceu.'
    : 'Um processo em segundo plano terminou. Verifique o resultado e me conte o que aconteceu.';
}
const timeoutNotice = (minutes) =>
  'Parei de acompanhar os processos em segundo plano depois de ' +
  minutes +
  ' min (limite das Preferências). Eles continuam rodando na máquina; peça para eu conferi-los quando quiser.';
const stoppedNotice = () =>
  'Parei de acompanhar os processos em segundo plano. Eles continuam rodando na máquina; eu só não vou mais avisar quando terminarem.';
const endedNotice = () =>
  'O acompanhamento terminou: a IA encerrou. Os processos em segundo plano que ainda existirem continuam rodando.';
// Shown when the user closes the app while chats are being followed.
const closeWarning = (n) =>
  n +
  (n === 1 ? ' conversa está' : ' conversas estão') +
  ' acompanhando processos em segundo plano. Ao fechar o VeSTA o acompanhamento termina (os processos continuam rodando, mas ninguém avisará quando acabarem).';
const label = (n) => 'Acompanhando ' + n + (n === 1 ? ' processo' : ' processos') + ' em segundo plano';

// Registry of followed chats: chatId -> session (see send.cjs). Also arms the per-chat time limit.
function createFollows({ settings, onExpire, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const map = new Map();
  const drop = (chatId) => {
    const f = map.get(chatId);
    if (f) clearTimer(f.follow?.timer);
    map.delete(chatId);
    return f;
  };
  return {
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    get size() {
      return map.size;
    },
    ids: () => [...map.keys()],
    values: () => [...map.values()],
    drop,
    add(chatId, session) {
      drop(chatId);
      const since = now();
      session.follow = { since, deadline: deadlineOf(since, settings()) };
      session.follow.timer = setTimer(() => onExpire?.(chatId), Math.max(0, session.follow.deadline - since));
      session.follow.timer.unref?.();
      map.set(chatId, session);
      return session;
    },
    // What the interface needs: who is followed, since when, until when and what is running.
    snapshot() {
      return [...map.entries()].map(([chatId, s]) => ({
        chatId,
        since: s.follow.since,
        deadline: s.follow.deadline,
        tasks: s.tasks || [],
      }));
    },
  };
}
module.exports = {
  DEFAULT_MINUTES,
  DEFAULT_MAX_CHATS,
  MIN_MINUTES,
  MAX_MINUTES,
  MAX_CHATS,
  NUDGE_MS,
  limits,
  shouldFollow,
  deadlineOf,
  expired,
  nudgeText,
  timeoutNotice,
  stoppedNotice,
  endedNotice,
  label,
  closeWarning,
  createFollows,
};
