// The ONLY operations a paired phone may call. Everything else (addProject, openData, openTerminal, saveSettings,
// deleteChat, memory, exportChat, updates, remote management...) answers 403, whether it exists or not.
// Each entry validates and trims its arguments: unknown fields are dropped, sizes are bounded.
class RemoteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new RemoteError(400, msg);

const ID = /^[\w.:-]{1,100}$/;
const T = {
  id: (v, k) => {
    if (typeof v !== 'string' || !ID.test(v)) throw bad('Campo inválido: ' + k);
    return v;
  },
  str:
    (max, { min = 0 } = {}) =>
    (v, k) => {
      if (typeof v !== 'string') throw bad('Campo inválido: ' + k);
      if (v.length > max) throw bad('Campo grande demais: ' + k);
      if (v.trim().length < min) throw bad('Campo obrigatório: ' + k);
      return v;
    },
  bool: (v, k) => {
    if (typeof v !== 'boolean') throw bad('Campo inválido: ' + k);
    return v;
  },
  int: (lo, hi) => (v, k) => {
    if (!Number.isInteger(v) || v < lo || v > hi) throw bad('Campo inválido: ' + k);
    return v;
  },
  oneOf: (values) => (v, k) => {
    if (!values.includes(v)) throw bad('Campo inválido: ' + k);
    return v;
  },
  // Free-form structure (quest steps): the engine normalizes it; here only shape and size are bounded.
  json:
    (check, maxBytes = 100_000) =>
    (v, k) => {
      if (!check(v) || JSON.stringify(v).length > maxBytes) throw bad('Campo inválido: ' + k);
      return v;
    },
};
// Ids of attachments the phone staged with /api/upload (at most 10 per message).
const attachmentIds = (v, k) => {
  if (!Array.isArray(v) || v.length > 10 || v.some((x) => typeof x !== 'string' || !/^[a-f0-9]{12}$/.test(x)))
    throw bad('Campo inválido: ' + k);
  return v;
};
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const PROVIDERS = ['claude', 'codex', 'drael', 'opencode'];
const MODES = ['edit', 'read', 'ask'];
const nullable = (fn) => (v, k) => (v === null ? null : fn(v, k));

// name -> { args: { field: [validator, required?] }, result? }
const spec = (args = {}, result, check) => ({ args, result, check });
const req = (fn) => [fn, true];
const opt = (fn) => [fn, false];
const ALLOWED = {
  bootstrap: spec(),
  // Text is required unless the message carries attachments.
  send: spec({ chatId: req(T.id), text: opt(T.str(50_000)), attachments: opt(attachmentIds) }, undefined, (out) => {
    if (!(out.text || '').trim() && !out.attachments?.length) throw bad('Campo obrigatório: text');
  }),
  attachmentData: spec({ chatId: req(T.id), id: req(T.id), full: opt(T.bool) }),
  stop: spec({ chatId: req(T.id) }),
  stopTask: spec({ chatId: req(T.id), taskId: req(T.str(200, { min: 1 })) }),
  answerPermission: spec({ id: req(T.id), decision: req(T.oneOf(['once', 'always', 'deny'])) }),
  createChat: spec(
    {
      provider: req(T.oneOf(PROVIDERS)),
      model: opt(T.str(120)),
      mode: opt(T.oneOf(MODES)),
      projectId: opt(nullable(T.id)),
      memory: opt(T.bool),
    },
    'chat'
  ),
  updateChat: spec({ id: req(T.id), model: opt(T.str(120)), mode: opt(T.oneOf(MODES)) }),
  usage: spec(),
  refreshUsage: spec({ force: opt(T.bool) }),
  createQuest: spec({
    title: req(T.str(120, { min: 1 })),
    goal: opt(T.str(8000)),
    guidelines: opt(T.str(8000)),
    projectId: opt(nullable(T.id)),
    maxParallel: opt(T.int(1, 6)),
    steps: opt(T.json(Array.isArray)),
    plan: opt(T.json((v) => isObj(v) && PROVIDERS.includes(v.provider), 1000)),
  }),
  replan: spec({ id: req(T.id), provider: req(T.oneOf(PROVIDERS)), model: opt(T.str(120)) }),
  startQuest: spec({ id: req(T.id), maxParallel: opt(T.int(1, 6)) }),
  pauseQuest: spec({ id: req(T.id) }),
  resumeQuest: spec({ id: req(T.id) }),
  cancelQuest: spec({ id: req(T.id) }),
  retryStep: spec({ id: req(T.id), stepId: req(T.id) }),
  skipStep: spec({ id: req(T.id), stepId: req(T.id) }),
};
const isAllowed = (name) => typeof name === 'string' && Object.hasOwn(ALLOWED, name);

// Returns the cleaned arguments or throws RemoteError(400).
function validateArgs(name, args) {
  if (!isAllowed(name)) throw new RemoteError(403, 'Operação não permitida no controle remoto');
  if (args === undefined || args === null) args = {};
  if (!isObj(args)) throw bad('Argumentos inválidos');
  const out = {};
  for (const [field, [check, required]] of Object.entries(ALLOWED[name].args)) {
    const v = Object.hasOwn(args, field) ? args[field] : undefined;
    if (v === undefined) {
      if (required) throw bad('Campo obrigatório: ' + field);
      continue;
    }
    out[field] = check(v, field);
  }
  ALLOWED[name].check?.(out);
  return out;
}
module.exports = { ALLOWED, isAllowed, validateArgs, RemoteError };
