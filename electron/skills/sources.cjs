// Skills that come from this computer: text pasted on the screen, a SKILL.md or folder picked in the dialog, or a
// skill an AI already has (Na sua IA → Trazer para o VeSTA). Each becomes a candidate, the same shape scanGithub
// returns: { name, description, text, files: [{ path, text }], skipped, hasScripts, source }.
const fs = require('node:fs'),
  path = require('node:path');
const { UserError } = require('../app/errors.cjs');
const F = require('./format.cjs');
const { findSkills } = require('./native.cjs');

// A pasted skill without front matter gets its name from the first heading.
function fromText(text, { label = 'Criadas por você', kind = 'paste' } = {}) {
  const src = String(text || '').trim();
  if (src.length < 20) throw new UserError('Cole o conteúdo da skill (o texto do SKILL.md).');
  const { data, body } = F.parseSkill(src);
  const heading = /^#\s+(.+)$/m.exec(body)?.[1] || '';
  const name = F.skillName(data, heading) || 'minha-skill';
  return {
    name,
    description: String(data.description || '').slice(0, 600),
    text: src,
    files: [],
    skipped: [],
    hasScripts: false,
    source: { kind, label, url: '', path: '', license: '' },
  };
}

// A folder holding SKILL.md (its supporting files come along, within the limits).
function fromDir(dir, source) {
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) throw new UserError('Essa pasta não tem um SKILL.md.');
  const text = fs.readFileSync(file, 'utf8');
  const { data } = F.parseSkill(text);
  const files = [],
    skipped = [];
  let total = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).replace(/\\/g, '/');
      if (e.isDirectory()) {
        if (!['node_modules', '.git'].includes(e.name) && !fs.existsSync(path.join(p, 'SKILL.md'))) walk(p);
        continue;
      }
      if (rel === 'SKILL.md') continue;
      const size = fs.statSync(p).size;
      if (!F.isTextFile(rel) || size > F.LIMITS.fileBytes || files.length >= F.LIMITS.files) skipped.push(rel);
      else if (total + size <= F.LIMITS.totalBytes) {
        total += size;
        files.push({ path: rel, text: fs.readFileSync(p, 'utf8') });
      } else skipped.push(rel);
    }
  })(dir);
  return {
    name: F.skillName(data, path.basename(dir)),
    description: String(data.description || '').slice(0, 600),
    text,
    files,
    skipped,
    hasScripts: files.some((f) => F.isScript(f.path)),
    source,
  };
}

// A path picked in the dialog: a SKILL.md, another .md (a skill in one file), or a folder with one or more skills.
function fromPath(p) {
  const st = fs.statSync(p);
  const source = { kind: 'file', label: 'Criadas por você', url: '', path: '', license: '' };
  if (st.isFile()) {
    if (path.basename(p) === 'SKILL.md') return [fromDir(path.dirname(p), source)];
    if (!/\.(md|markdown|txt)$/i.test(p)) throw new UserError('Escolha um SKILL.md, um .md ou uma pasta.');
    return [fromText(fs.readFileSync(p, 'utf8'), { kind: 'file' })];
  }
  const found = findSkills(p, 5).slice(0, 200);
  if (!found.length) throw new UserError('Nenhuma SKILL.md nessa pasta.');
  return found.map((f) => fromDir(path.dirname(f), source));
}

module.exports = { fromText, fromDir, fromPath };
