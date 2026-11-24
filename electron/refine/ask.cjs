// One turn in a hidden chat, for the work refining does on its own (the automatic review, the tests of a proposal):
// a chat with `refineRun` set (out of Conversas, of the phone and of the memory), mode read, no memory, sent through
// the regular send flow; the answer comes back as text and the chat goes.
// deps (tests): { send(ctx, args), now() }
const { UserError } = require('../app/errors.cjs');

const TURN_MS = 10 * 60 * 1000;

function createAsker(ctx, deps = {}) {
  const store = ctx.store;
  const send = deps.send || ((...a) => require('../chat/send.cjs').send(...a));
  const installed = deps.installed || ((p) => !!ctx.integrations?.[p]?.installed);
  const waiters = new Map(); // chat id -> { resolve, reject, timer }
  const drop = (id) => {
    const chats = store.state.chats;
    const i = chats.findIndex((c) => c.id === id);
    if (i >= 0) chats.splice(i, 1);
  };
  // opts: { provider, model, projectId, title, refine ({ kind, name | id }: the refine tools are offered) }
  async function ask(opts, text, { timeoutMs = TURN_MS } = {}) {
    if (!installed(opts.provider)) throw new UserError('A IA escolhida não está instalada (tela Conexões)');
    const chat = store.addChat({
      provider: opts.provider,
      model: opts.model || '',
      projectId: opts.projectId || null,
      mode: 'read',
      memory: false,
    });
    chat.title = opts.title || 'Refino';
    chat.refineRun = true;
    chat.skills = false;
    if (opts.refine) chat.refine = opts.refine;
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(chat.id);
          ctx.stopChat?.(chat.id);
          reject(new UserError('A IA demorou demais para responder.'));
        }, timeoutMs);
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
    } finally {
      drop(chat.id);
      store.saveSoon?.();
    }
  }
  function onChatDone({ chatId, status }) {
    const w = waiters.get(chatId);
    if (!w) return;
    waiters.delete(chatId);
    clearTimeout(w.timer);
    const chat = store.state.chats.find((c) => c.id === chatId);
    const reply = [...(chat?.messages || [])].reverse().find((m) => m.role === 'assistant');
    if (status === 'done' && reply) w.resolve(reply.text || '');
    else w.reject(new UserError(reply?.error || 'A IA parou antes de responder.'));
  }
  // Hidden chats left by a run the app closed in the middle.
  function recover() {
    const chats = store.state.chats;
    for (let i = chats.length - 1; i >= 0; i--) if (chats[i].refineRun) chats.splice(i, 1);
  }
  return { ask, onChatDone, recover };
}

// The first JSON value in an answer (a ```json block, or from the first { or [ to its last } or ]), or null.
function parseJson(text) {
  const src = String(text || '');
  const block = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(src);
  const tries = block ? [block[1]] : [];
  // Whichever opens first is the value: a list of objects starts with "[", not with its first "{".
  const spans = [
    ['{', '}'],
    ['[', ']'],
  ]
    .map(([open, close]) => [src.indexOf(open), src.lastIndexOf(close)])
    .filter(([a, b]) => a >= 0 && b > a)
    .sort((x, y) => x[0] - y[0]);
  for (const [a, b] of spans) tries.push(src.slice(a, b + 1));
  for (const t of tries)
    try {
      return JSON.parse(t);
    } catch {}
  return null;
}

module.exports = { createAsker, parseJson, TURN_MS };
