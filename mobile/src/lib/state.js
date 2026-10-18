import { applyEvents } from '../../../src/lib/streamBuffer.js';

// Pure state handling of the phone app: merging the server's incremental snapshots and deriving what to show.
export const emptyState = {
  settings: {},
  projects: [],
  chats: [],
  quests: [],
  running: [],
  appVersion: '',
};

// Merges a partial 'state' event ({ ...lite, chatIds, chats: [changed] }) into the current state.
// `missing` is true when the server refers to a chat we never received: the caller must reload everything.
export function mergeState(prev, ev) {
  const changed = new Map((ev.chats || []).map((c) => [c.id, c]));
  const known = new Map(prev.chats.map((c) => [c.id, c]));
  let missing = false;
  const chats = (ev.chatIds || []).map((id) => {
    const c = changed.get(id) || known.get(id);
    if (!c) missing = true;
    return c;
  });
  const { chatIds, chats: _c, partial, type, ...lite } = ev;
  return { state: { ...prev, ...lite, chats: missing ? prev.chats : chats }, missing };
}

// Applies a batch of server events in order. Stream events (text/activity/subagent/permission) go through the same
// pure reducer as the desktop; 'state' snapshots replace what they carry; 'chat-done' is recorded for the mascot.
export function reduceEvents(prev, events, now = Date.now()) {
  let state = prev.state,
    done = prev.done,
    stream = [],
    missing = false;
  const flush = () => {
    if (!stream.length) return;
    state = { ...state, chats: applyEvents(state.chats, stream) };
    stream = [];
  };
  for (const e of events) {
    if (e.type === 'state') {
      flush();
      const r = mergeState(state, e);
      state = r.state;
      missing ||= r.missing;
    } else if (e.type === 'chat-done') {
      flush();
      done = { ...done, [e.chatId]: { at: now, status: e.status } };
    } else stream.push(e);
  }
  flush();
  return { state, done, missing };
}

// Permission requests waiting for an answer, newest first. Only the last assistant message of a chat can have them.
export function pendingPermissions(chats) {
  const out = [];
  for (const chat of chats)
    for (let i = chat.messages.length - 1; i >= 0 && i >= chat.messages.length - 2; i--) {
      const m = chat.messages[i];
      for (const p of m.permissions || [])
        if (p.status === 'pending') out.push({ chat, messageId: m.id, permission: p });
    }
  return out.sort((a, b) => b.permission.createdAt - a.permission.createdAt);
}

const RECENT_DONE_MS = 2 * 60 * 1000;
// idle | thinking | working | success | error | sleeping — mirrors what the AI of a chat is doing.
export function chatMood(chat, { running = false, waiting = false, done, now = Date.now() } = {}) {
  const last = chat.messages[chat.messages.length - 1];
  if (running) {
    if (waiting) return 'thinking';
    const busy = last && last.role === 'assistant' && (last.text || last.activities?.length || last.subagents?.length);
    return busy ? 'working' : 'thinking';
  }
  const status = done?.status || (last?.role === 'assistant' ? last.status : null);
  const at = done?.at ?? last?.createdAt ?? 0;
  if (status === 'error') return now - at < 60 * 60 * 1000 ? 'error' : 'idle';
  if (status === 'done' && now - at < RECENT_DONE_MS) return 'success';
  return 'idle';
}
// One mascot for the whole app.
export function appMood({ online, chats, running, pending, done, now = Date.now() }) {
  if (!online) return 'sleeping';
  if (pending > 0) return 'thinking';
  if (running.length) return 'working';
  const moods = chats.map((c) => chatMood(c, { done: done[c.id], now }));
  if (moods.includes('error')) return 'error';
  if (moods.includes('success')) return 'success';
  return 'idle';
}

// Last text of a chat for the list (markdown flattened).
export function snippet(chat, max = 90) {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const t = (chat.messages[i].text || '')
      .replace(/[`*_#>\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
  return '';
}

// Router: '#/chat/ID' -> { name: 'chat', id }
export function parseRoute(hash) {
  const m = /^#\/([a-z]+)(?:\/([\w.:-]+))?$/.exec(hash || '');
  const name = m ? m[1] : 'chats';
  return {
    name: ['chats', 'chat', 'atividade', 'quests', 'quest', 'uso'].includes(name) ? name : 'chats',
    id: m?.[2] || null,
  };
}
// Pairing code in the URL fragment (#pair=CODE): returns the code or ''.
export function pairingCode(hash) {
  const m = /^#pair=([\w-]{16,200})$/.exec(hash || '');
  return m ? m[1] : '';
}
