// What the phone may see. The desktop state carries internal paths, session ids, memory notes and device hashes:
// none of that leaves the machine. Also builds the incremental "state" events (only chats that changed).
const MAX_MESSAGES = 80;

const { publicAttachment } = require('../attachments.cjs');
const SETTINGS = ['theme', 'accent', 'fontScale'];
// Attachments reach the phone without their filesystem paths.
const phoneMessage = (m) => (m.attachments ? { ...m, attachments: m.attachments.map(publicAttachment) } : m);
function sanitizeChat(chat, { maxMessages = MAX_MESSAGES } = {}) {
  const messages = chat.messages || [];
  const cut = Math.max(0, messages.length - maxMessages);
  return {
    id: chat.id,
    title: chat.title,
    provider: chat.provider,
    model: chat.model || '',
    mode: chat.mode,
    projectId: chat.projectId || null,
    questId: chat.questId || null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    hiddenMessages: cut,
    messages: (cut ? messages.slice(cut) : messages).map(phoneMessage),
  };
}
// Fields every state event carries (small); chats travel apart because they are the heavy part.
function sanitizeLite(state) {
  const settings = {};
  for (const k of SETTINGS) if (state.settings && state.settings[k] !== undefined) settings[k] = state.settings[k];
  return {
    settings,
    projects: (state.projects || []).map((p) => ({ id: p.id, name: p.name })),
    quests: state.quests || [],
    running: state.running || [],
    appVersion: state.appVersion || '',
  };
}
function sanitizeState(state, opts) {
  return { ...sanitizeLite(state), chats: (state.chats || []).map((c) => sanitizeChat(c, opts)) };
}
function sanitizeIntegrations(integrations) {
  const out = {};
  for (const [id, p] of Object.entries(integrations || {}))
    out[id] = {
      id,
      installed: !!p.installed,
      version: p.version || '',
      authenticated: p.authenticated ?? null,
      models: Array.isArray(p.models) ? p.models.slice(0, 200) : [],
    };
  return out;
}

// Cheap fingerprint of a chat: changes whenever something the phone shows changes.
function chatSignature(chat) {
  const msgs = chat.messages || [],
    last = msgs[msgs.length - 1];
  return [
    chat.title,
    chat.model,
    chat.mode,
    chat.provider,
    chat.updatedAt,
    msgs.length,
    last
      ? [last.status, (last.text || '').length, last.activities?.length || 0, last.subagents?.length || 0].join(':')
      : '',
    last?.permissions?.length || 0,
    last?.permissions ? last.permissions.map((p) => p.status[0]).join('') : '',
  ].join('|');
}
// Keeps the signatures of the last state sent, to send only what changed since.
function createStateDiffer(opts) {
  let sigs = new Map();
  return {
    // Event payload: { ...lite, chatIds: [all ids in order], chats: [changed] }
    diff(state) {
      const next = new Map(),
        changed = [];
      for (const c of state.chats || []) {
        const sig = chatSignature(c);
        next.set(c.id, sig);
        if (sigs.get(c.id) !== sig) changed.push(sanitizeChat(c, opts));
      }
      sigs = next;
      return { ...sanitizeLite(state), chatIds: (state.chats || []).map((c) => c.id), chats: changed, partial: true };
    },
  };
}
module.exports = {
  sanitizeChat,
  sanitizeLite,
  sanitizeState,
  sanitizeIntegrations,
  chatSignature,
  createStateDiffer,
  MAX_MESSAGES,
};
