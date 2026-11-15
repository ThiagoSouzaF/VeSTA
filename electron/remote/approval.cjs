// Which calls from a phone need a yes at the desktop before they give an AI full access ('edit'), as a pure function
// of the call and the current state. remote/index.cjs asks the question and remembers what was approved.
//
// A quest is approved for one set of full-access steps (their signature): starting it again with the same steps does
// not ask again; any change in what runs with full access (new step, other AI, title or instructions) asks.
const { createHash } = require('node:crypto');

const MODES = ['edit', 'read', 'ask'];
const FINISHED = ['done', 'skipped', 'cancelled'];

const stepsToRun = (q) => (q?.steps || []).filter((s) => s.mode === 'edit' && !FINISHED.includes(s.status));
const signature = (q) =>
  createHash('sha256')
    .update(JSON.stringify(stepsToRun(q).map((s) => [s.id, s.title, s.instructions, s.provider])))
    .digest('hex');

// -> { args, ask, rememberNow, rememberAfter }
//   args: the call's arguments with the phone's defaults (a chat or step from the phone asks for permission);
//   ask: what the desktop question says is getting full access, or null when no question is needed;
//   rememberNow / rememberAfter: the quest whose steps count as approved once the user said yes, before or after the
//   call runs ('new' = the quest the call creates).
function review(name, args, state, approved) {
  const out = { args, ask: null, rememberNow: null, rememberAfter: null };
  const quest = (id) => state.quests?.find((x) => x.id === id);
  if (name === 'createChat') {
    // Drael cannot ask for permission: it only reads.
    const mode = MODES.includes(args.mode) ? args.mode : args.provider === 'drael' ? 'read' : 'ask';
    out.args = { ...args, mode };
    if (mode === 'edit') out.ask = 'a um novo chat (' + args.provider + ')';
  } else if (name === 'updateChat' && args.mode === 'edit') {
    const chat = state.chats?.find((c) => c.id === args.id);
    if (chat && chat.mode !== 'edit') out.ask = 'ao chat "' + chat.title + '"';
  } else if (name === 'createQuest') {
    const steps = (args.steps || []).map((s) =>
      s && typeof s === 'object' && !Array.isArray(s) ? { ...s, mode: MODES.includes(s.mode) ? s.mode : 'ask' } : s
    );
    out.args = { ...args, steps };
    if (steps.some((s) => s?.mode === 'edit')) out.ask = 'a etapas da quest "' + args.title + '"';
    out.rememberAfter = 'new';
  } else if (name === 'startQuest' || name === 'resumeQuest' || name === 'retryStep') {
    // Steps can also arrive in full access from the planning AI: starting them is the moment to ask.
    const q = quest(args.id);
    const n = stepsToRun(q).length;
    if (q && n && approved.get(q.id) !== signature(q)) {
      out.ask = 'à quest "' + q.title + '" (' + n + ' etapa(s) em acesso completo)';
      out.rememberNow = q.id;
    }
  } else if (name === 'addStep' || name === 'updateStep') {
    // Same rule as chats: a step that ends up in full access because of the phone needs a yes at the desktop.
    const q = quest(args.id);
    const cur = name === 'updateStep' ? q?.steps?.find((s) => s.id === args.stepId) : null;
    if (name === 'addStep') out.args = { ...args, mode: args.mode || (args.provider === 'drael' ? 'read' : 'ask') };
    const mode = out.args.mode || cur?.mode;
    // Editing what a full-access step does (AI, title, instructions) also changes what runs with full access.
    const changes =
      name === 'addStep' ||
      !cur ||
      cur.mode !== 'edit' ||
      ['provider', 'title', 'instructions'].some((k) => args[k] !== undefined && args[k] !== cur[k]);
    if (q && mode === 'edit' && changes) {
      out.ask = 'à etapa "' + (cur?.title || args.title) + '" da quest "' + q.title + '"';
      // The quest stays approved only if it was before this change (the yes covers this change, not older ones).
      const wasApproved = approved.get(q.id) === signature(q) || stepsToRun(q).every((s) => s.id === cur?.id);
      if (wasApproved) out.rememberAfter = q.id;
    }
  }
  return out;
}

module.exports = { MODES, review, signature, stepsToRun };
