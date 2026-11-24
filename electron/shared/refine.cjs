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

module.exports = { MAX_VERSIONS, lineDiff, diffStats, diffHunks, pushVersion, cleanChanges, cleanNote };
