// The SKILL.md format shared by Claude Code, Codex and VeSTA: a YAML-ish front matter (name, description, ...) and a
// Markdown body. Only the subset skills use is read: `key: value`, quoted values and folded/literal blocks (`>-`, `|`).
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Rough token count (about 3.6 characters per token for mixed Portuguese/English Markdown).
const tokens = (text) => Math.ceil(String(text || '').length / 3.6);

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    const inner = t.slice(1, -1);
    return t[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
  }
  return t;
}

// -> { data: {key: string}, body } (data is {} when there is no front matter).
function parseSkill(text) {
  const src = String(text || '')
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { data: {}, body: src.trim() };
  const data = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (/^[>|][+-]?$/.test(raw.trim())) {
      // Block scalar: the indented lines below. ">" folds them into one line, "|" keeps the breaks.
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === ''))
        block.push(lines[++i]);
      const parts = block.map((l) => l.trim());
      data[key] = (raw.trim()[0] === '>' ? parts.join(' ').replace(/\s+/g, ' ') : parts.join('\n')).trim();
    } else data[key] = unquote(raw);
  }
  return { data, body: src.slice(m[0].length).trim() };
}

// The name a skill goes by in VeSTA (and after "/"): its front matter name, else the folder name, normalized.
function skillName(data, fallback = '') {
  const n = String(data.name || fallback || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return NAME.test(n) ? n : '';
}

// Rewrites the front matter with `data` (string values only), keeping the body.
function withFrontmatter(text, patch) {
  const { data, body } = parseSkill(text);
  const merged = { ...data, ...patch };
  const yaml = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => k + ': ' + JSON.stringify(String(v)))
    .join('\n');
  return '---\n' + yaml + '\n---\n\n' + body + '\n';
}

// Files that travel with a skill and can be read as text (scripts included: kept, never run by VeSTA).
const TEXT_EXT =
  /\.(md|markdown|txt|json|ya?ml|toml|csv|tsv|js|cjs|mjs|ts|tsx|jsx|py|sh|ps1|bat|cmd|rb|go|rs|java|kt|sql|html|css|xml|ini|cfg|env\.example|tla|mmd|dot)$/i;
const SCRIPT_EXT = /\.(js|cjs|mjs|ts|tsx|py|sh|ps1|bat|cmd|rb|go|rs|java|kt|exe)$/i;
const isTextFile = (p) => TEXT_EXT.test(p) || /(^|\/)(LICENSE|README|NOTICE)$/i.test(p) || !/\.[^/]+$/.test(p);
const isScript = (p) => SCRIPT_EXT.test(p) || /(^|\/)scripts\//.test(p);
// Limits of one skill: enough for the biggest real ones (dozens of references), not for a whole repository.
const LIMITS = { files: 60, fileBytes: 200_000, totalBytes: 1_500_000 };

module.exports = { NAME, tokens, parseSkill, skillName, withFrontmatter, isTextFile, isScript, LIMITS };
