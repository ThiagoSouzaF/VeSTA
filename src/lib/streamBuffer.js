import { patchMessage } from './messages.js';

// Applies a batch of stream events (text / activity / subagent / permission) to the chats in one pass.
// Chats and messages without events keep their identity, so memoized components skip them. Consecutive text
// deltas of one message are joined first: one string concatenation per frame instead of one per delta.
export function applyEvents(chats, events) {
  if (!events.length) return chats;
  const byChat = new Map();
  for (const e of events) {
    let msgs = byChat.get(e.chatId);
    if (!msgs) byChat.set(e.chatId, (msgs = new Map()));
    const list = msgs.get(e.messageId);
    if (list) list.push(e);
    else msgs.set(e.messageId, [e]);
  }
  let changed = false;
  const next = chats.map((c) => {
    const msgs = byChat.get(c.id);
    if (!msgs) return c;
    let touched = false;
    const messages = c.messages.map((m) => {
      const list = msgs.get(m.id);
      if (!list) return m;
      touched = true;
      return applyToMessage(m, list);
    });
    if (!touched) return c;
    changed = true;
    return { ...c, messages };
  });
  return changed ? next : chats;
}
function applyToMessage(m, events) {
  let text = '';
  const rest = [];
  for (const e of events) {
    if (e.type === 'text') text += e.text;
    else rest.push(e);
  }
  let out = text ? patchMessage(m, { type: 'text', text }) : m;
  for (const e of rest) out = patchMessage(out, e);
  return out;
}

// Collects events and hands them to `apply` once per animation frame.
//   push(e)   queue an event (schedules the frame)
//   flush()   apply what is queued now
//   discard() drop what is queued (a full state snapshot already contains it)
export function createEventBuffer(
  apply,
  { schedule = (fn) => requestAnimationFrame(fn), cancel = (h) => cancelAnimationFrame(h) } = {}
) {
  let pending = [],
    handle = null;
  const run = () => {
    handle = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    apply(batch);
  };
  return {
    push(e) {
      pending.push(e);
      if (handle == null) handle = schedule(run);
    },
    flush() {
      if (handle != null) cancel(handle);
      run();
    },
    discard() {
      if (handle != null) cancel(handle);
      handle = null;
      pending = [];
    },
    get size() {
      return pending.length;
    },
  };
}
