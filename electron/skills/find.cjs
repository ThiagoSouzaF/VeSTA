// Finds a skill by name wherever it lives: the VeSTA library and what each AI has on its own (Claude Code, Codex; see
// native.cjs). Used by the vesta_skill_find tool (the /explain-skill skill reads skills through it). Read only.
//   findSkill({ query, ai, lib, native }) -> [{ origem, ai, name, description, text?, files, path? }] best first
const fs = require('node:fs'),
  path = require('node:path');
const { slug } = require('../util/text.cjs');

const AIS = ['vesta', 'claude', 'codex'];
const MAX_RESULTS = 5;
const WITH_TEXT = 3;
const MAX_TEXT = 40000;
const MAX_FILES = 60;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__']);

// Supporting files of a skill folder (relative paths, SKILL.md left out).
function filesOf(dir, base = dir, out = [], depth = 3) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0 && !SKIP.has(e.name)) filesOf(p, base, out, depth - 1);
    } else if (!(dir === base && e.name === 'SKILL.md')) out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

// 3 same name, 2 the name contains the query (or the reverse), 1 the description mentions it, 0 nothing.
function score(query, name, description) {
  const q = slug(query, 80, ''),
    n = slug(name, 80, '');
  if (!q) return 0;
  if (q === n) return 3;
  if (n.includes(q) || (q.length >= 4 && q.includes(n))) return 2;
  return String(description || '')
    .toLowerCase()
    .includes(String(query).toLowerCase().trim())
    ? 1
    : 0;
}

function findSkill({ query, ai = '', lib, native }) {
  const want = String(ai || '')
    .toLowerCase()
    .replace(/^(vesta|biblioteca)$/, 'vesta')
    .replace(/^(chatgpt|openai)$/, 'codex')
    .replace(/^(claude code|claude-code)$/, 'claude');
  if (want && !AIS.includes(want)) return [];
  const hits = [];
  if (!want || want === 'vesta')
    for (const s of lib?.list() || [])
      hits.push({ score: score(query, s.name, s.description), ai: 'vesta', origem: 'Biblioteca do VeSTA', s });
  const n = native ? native() : { claude: [], codex: [] };
  for (const p of ['claude', 'codex'])
    if (!want || want === p)
      for (const s of n[p] || [])
        hits.push({
          score: score(query, s.name, s.description),
          ai: p,
          origem: (p === 'claude' ? 'Claude Code' : 'Codex') + ' · ' + s.label,
          s,
        });
  return hits
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((h, i) => {
      const out = { origem: h.origem, ai: h.ai, name: h.s.name, description: h.s.description || '' };
      if (h.ai === 'vesta') {
        const r = i < WITH_TEXT ? lib.read(h.s.name) : null;
        return {
          ...out,
          ...(r ? { text: r.text.slice(0, MAX_TEXT) } : {}),
          files: (r?.files || []).map((f) => f.path),
        };
      }
      let text;
      try {
        if (i < WITH_TEXT) text = fs.readFileSync(path.join(h.s.dir, 'SKILL.md'), 'utf8').slice(0, MAX_TEXT);
      } catch {}
      return { ...out, ...(text ? { text } : {}), path: h.s.dir, files: filesOf(h.s.dir) };
    });
}

module.exports = { findSkill, score };
