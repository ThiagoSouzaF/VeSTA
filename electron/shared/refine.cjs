// Refining skills and agents: the line diff the screen shows between the text in use and a proposal, and the version
// list both keep (every change saves what was there before, so it can come back). Pure, no require: also loaded by
// the renderer (vite.shared.mjs).
//
// Version { n, at, note, tokens? (skill) | prompt, lessons[] (agent) }: newest first, at most MAX_VERSIONS.
const MAX_VERSIONS = 15;
const MAX_NOTE = 160;
// Above this many line pairs the diff stops looking for common lines (a proposal is a few hundred lines at most).
const MAX_CELLS = 2000000;

const linesOf = (t) =>
  String(t == null ? '' : t)
    .replace(/\r\n/g, '\n')
    .split('\n');

// -> [{ op: ' ' | '+' | '-', text }]: '-' only in the text in use, '+' only in the proposal.
function lineDiff(before, after) {
  const a = linesOf(before),
    b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const head = a.slice(0, start).map((text) => ({ op: ' ', text }));
  const tail = a.slice(endA).map((text) => ({ op: ' ', text }));
  const x = a.slice(start, endA),
    y = b.slice(start, endB);
  let mid = [];
  if (x.length * y.length > MAX_CELLS)
    mid = [...x.map((text) => ({ op: '-', text })), ...y.map((text) => ({ op: '+', text }))];
  else {
    // Longest common subsequence, then walked from the start.
    const w = y.length + 1;
    const len = new Uint32Array((x.length + 1) * w);
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        len[i * w + j] =
          x[i] === y[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    let i = 0,
      j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) mid.push({ op: ' ', text: x[i++] }), j++;
      else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) mid.push({ op: '-', text: x[i++] });
      else mid.push({ op: '+', text: y[j++] });
    }
    while (i < x.length) mid.push({ op: '-', text: x[i++] });
    while (j < y.length) mid.push({ op: '+', text: y[j++] });
  }
  return [...head, ...mid, ...tail];
}

const diffStats = (d) => ({
  added: d.filter((l) => l.op === '+').length,
  removed: d.filter((l) => l.op === '-').length,
});

// The diff around the changes only: runs of unchanged lines longer than 2*context become one { op: '…', text: 'N linhas' }.
function diffHunks(d, context = 2) {
  const out = [];
  let i = 0;
  while (i < d.length) {
    if (d[i].op !== ' ') {
      out.push(d[i++]);
      continue;
    }
    let j = i;
    while (j < d.length && d[j].op === ' ') j++;
    const run = d.slice(i, j);
    const keepHead = i === 0 ? 0 : context,
      keepTail = j === d.length ? 0 : context;
    if (run.length > keepHead + keepTail + 1) {
      out.push(...run.slice(0, keepHead));
      out.push({ op: '…', text: run.length - keepHead - keepTail + ' linhas iguais' });
      out.push(...run.slice(run.length - keepTail));
    } else out.push(...run);
    i = j;
  }
  return out;
}

const cleanNote = (note) =>
  String(note || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOTE);

// The list with one more version at the top (numbered after the highest) -> { list, entry, dropped: [n...] }.
function pushVersion(list, data, at = Date.now()) {
  const prev = Array.isArray(list) ? list : [];
  const n = prev.reduce((m, v) => Math.max(m, v.n || 0), 0) + 1;
  const entry = { ...data, n, at, note: cleanNote(data.note) };
  const all = [entry, ...prev];
  return { list: all.slice(0, MAX_VERSIONS), entry, dropped: all.slice(MAX_VERSIONS).map((v) => v.n) };
}

// One line for each change of a proposal (what the AI said it changed).
const cleanChanges = (changes) =>
  (Array.isArray(changes) ? changes : [])
    .map((c) => cleanNote(c))
    .filter(Boolean)
    .slice(0, 12);

// ---- Signals (no AI): how a skill or an agent has been doing since it was last reviewed ---------------------------
// What the person says right after an answer when it went wrong: a correction is the strongest signal there is.
const CORRECTION =
  /^\s*(n[ãa]o[\s,.!]|n[ãa]o$|errad|est[áa] errad|na verdade|refa[çc]a|de novo|corrij|faltou|esqueceu|pare\b|para com|n[ãa]o era (isso|assim)|era pra|deveria|wrong|no[,.! ]|that'?s not|actually|redo|try again)/i;
const isCorrection = (text) => CORRECTION.test(String(text || ''));
// Chats the person never sees (or the refinement ones) say nothing about how a skill did.
const hiddenChat = (c) => !c || c.skillDraft || c.memoryConsolidation || c.refine || c.refineRun;

// A use of a skill in a chat -> { reply, next } (the answer and what the person said next), or null.
function turnAt(chat, at) {
  const msgs = chat.messages || [];
  let i = -1;
  for (let k = 0; k < msgs.length; k++) if (msgs[k].role === 'user' && (msgs[k].createdAt || 0) <= at + 1000) i = k;
  if (i < 0) return null;
  return {
    ask: msgs[i],
    reply: msgs.slice(i + 1).find((m) => m.role === 'assistant') || null,
    next: msgs.slice(i + 1).find((m) => m.role === 'user') || null,
  };
}
// -> { since, uses, corrections, errors }: the uses after the last review (meta.reviewedAt).
function skillSignals(meta, chats) {
  const since = meta?.reviewedAt || 0;
  const out = { since, uses: 0, corrections: 0, errors: 0 };
  for (const r of meta?.recent || []) {
    if (r.at <= since) continue;
    const c = (chats || []).find((x) => x.id === r.chatId);
    if (hiddenChat(c)) continue;
    const t = turnAt(c, r.at);
    if (!t) continue;
    out.uses++;
    if (t.reply?.error || t.reply?.status === 'error' || t.reply?.status === 'stopped') out.errors++;
    else if (isCorrection(t.next?.text)) out.corrections++;
  }
  return out;
}
// -> { since, runs, errors, corrections, pending }: runs after the last review, the failed ones, the run chats where
// the person corrected the agent, and lessons still waiting for a yes.
function agentSignals(agent, chats) {
  const since = agent?.reviewedAt || 0;
  const runs = (agent?.runs || []).filter((r) => r.at > since && r.status !== 'running');
  let corrections = 0;
  for (const r of runs) {
    const c = r.chatId && (chats || []).find((x) => x.id === r.chatId);
    if (
      c &&
      (c.messages || [])
        .filter((m) => m.role === 'user')
        .slice(1)
        .some((m) => isCorrection(m.text))
    )
      corrections++;
  }
  return {
    since,
    runs: runs.length,
    errors: runs.filter((r) => r.status === 'error').length,
    corrections,
    pending: (agent?.lessons || []).filter((l) => l.status === 'pending' && l.at > since).length,
  };
}
// How much a review is called for (0 = not now). A waiting proposal, a skill turned off or a removed agent never.
const REVIEW_USES = 5;
function reviewWeight(kind, target, sig) {
  if (!target || target.proposal) return 0;
  if (kind === 'skill') {
    if (target.enabled === false) return 0;
    const bad = sig.corrections + sig.errors;
    return bad ? 10 * bad + sig.uses : sig.uses >= REVIEW_USES ? 1 : 0;
  }
  const bad = sig.errors + sig.corrections;
  return bad ? 10 * bad + sig.pending : sig.pending >= 2 ? sig.pending : 0;
}

// What calls for a review now, the most urgent first -> [{ kind, name | id, label, weight, signals }].
function candidates({ skills = [], agents = [], chats = [] }) {
  const out = [];
  for (const s of skills) {
    const signals = skillSignals(s, chats);
    const weight = reviewWeight('skill', s, signals);
    if (weight) out.push({ kind: 'skill', name: s.name, label: '/' + s.name, weight, signals });
  }
  for (const a of agents) {
    const signals = agentSignals(a, chats);
    const weight = reviewWeight('agent', a, signals);
    if (weight) out.push({ kind: 'agent', id: a.id, label: a.name, weight, signals });
  }
  return out.sort((x, y) => y.weight - x.weight);
}

module.exports = {
  MAX_VERSIONS,
  candidates,
  REVIEW_USES,
  lineDiff,
  diffStats,
  diffHunks,
  pushVersion,
  cleanChanges,
  cleanNote,
  isCorrection,
  hiddenChat,
  turnAt,
  skillSignals,
  agentSignals,
  reviewWeight,
};
