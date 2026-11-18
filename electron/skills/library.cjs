// The skills VeSTA keeps (Skills → No VeSTA), one folder per skill under <userData>/skills:
//   <name>/SKILL.md          the version every AI receives (adapted, or the original kept as is)
//   <name>/files/**          supporting files (references, examples, scripts: kept, never run by VeSTA)
//   <name>/original/**       what was imported, untouched (SKILL.md and its files), for "ver original"
//   <name>/skill.json        VeSTA's data: origin, on/off, when it is used, which AIs it works in, use count
// Names are unique: they are what follows the "/" in the chat.
const fs = require('node:fs'),
  path = require('node:path');
const { UserError } = require('../app/errors.cjs');
const { writeAtomic } = require('../util/sys.cjs');
const F = require('./format.cjs');

const PROVIDERS = ['claude', 'codex', 'opencode', 'drael'];
const MODES = ['auto', 'slash'];

// A relative path inside a skill, or null when it would leave the folder.
function safeRel(rel) {
  const r = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!r || r.split('/').some((p) => p === '..' || p === '' || /[:*?"<>|]/.test(p))) return null;
  return r;
}
function walk(dir, base = dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}
const normCompat = (c = {}) =>
  Object.fromEntries(
    PROVIDERS.map((p) => [p, typeof c[p] === 'string' && c[p].trim() ? c[p].trim().slice(0, 200) : 'ok'])
  );

function createLibrary(root) {
  let cache = null;
  const dirOf = (name) => path.join(root, name);
  function load() {
    const list = [];
    let names = [];
    try {
      names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && F.NAME.test(e.name));
    } catch {}
    for (const e of names)
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(root, e.name, 'skill.json'), 'utf8'));
        if (meta.name === e.name && fs.existsSync(path.join(root, e.name, 'SKILL.md'))) list.push(meta);
      } catch {}
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const list = () => (cache ||= load());
  const get = (name) => list().find((s) => s.name === name) || null;
  const must = (name) => {
    const s = get(name);
    if (!s) throw new UserError('Skill não encontrada: ' + name);
    return s;
  };
  const saveMeta = (meta) => {
    writeAtomic(path.join(dirOf(meta.name), 'skill.json'), JSON.stringify(meta, null, 2));
    cache = null;
    return meta;
  };
  function writeFiles(dir, files) {
    for (const f of files || []) {
      const rel = safeRel(f.path);
      if (!rel) continue;
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, f.text);
    }
  }
  return {
    root,
    list,
    get,
    // What the screen and the AIs read: SKILL.md, the original and the list of supporting files.
    read(name) {
      const meta = must(name);
      const dir = dirOf(name);
      const original = path.join(dir, 'original', 'SKILL.md');
      return {
        meta,
        text: fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'),
        original: fs.existsSync(original) ? fs.readFileSync(original, 'utf8') : null,
        files: walk(path.join(dir, 'files')).map((p) => ({
          path: p,
          size: fs.statSync(path.join(dir, 'files', p)).size,
          script: F.isScript(p),
        })),
      };
    },
    readFile(name, rel) {
      must(name);
      const r = safeRel(rel);
      const file = r && path.join(dirOf(name), 'files', r);
      if (!file || !fs.existsSync(file)) throw new UserError('Arquivo não encontrado nesta skill: ' + rel);
      return fs.readFileSync(file, 'utf8').slice(0, F.LIMITS.fileBytes);
    },
    // skill = { name, text (SKILL.md), files, original: { text, files }, source, compat, adaptedBy, changes, mode }
    // replace: an existing skill with this name is overwritten (an update keeps its on/off, mode and use count).
    install(skill, { replace = false } = {}) {
      const name = skill.name;
      if (!F.NAME.test(name || '')) throw new UserError('Nome de skill inválido: use letras minúsculas, números e "-"');
      const old = get(name);
      if (old && !replace) throw new UserError('Já existe uma skill /' + name + '. Renomeie ou atualize a existente.');
      const dir = dirOf(name);
      const tmp = dir + '.novo';
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      fs.writeFileSync(path.join(tmp, 'SKILL.md'), skill.text);
      writeFiles(path.join(tmp, 'files'), skill.files);
      if (skill.original?.text) {
        fs.mkdirSync(path.join(tmp, 'original'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'original', 'SKILL.md'), skill.original.text);
        writeFiles(path.join(tmp, 'original'), skill.original.files);
      }
      const { data } = F.parseSkill(skill.text);
      const now = Date.now();
      const meta = {
        name,
        description: String(data.description || skill.description || '').slice(0, 1024),
        source: {
          kind: skill.source?.kind || 'paste',
          label: String(skill.source?.label || 'Criadas por você').slice(0, 120),
          url: skill.source?.url || '',
          path: skill.source?.path || '',
          license: skill.source?.license || '',
        },
        enabled: old ? old.enabled : true,
        mode: MODES.includes(old?.mode) ? old.mode : MODES.includes(skill.mode) ? skill.mode : 'auto',
        compat: normCompat(skill.compat),
        adaptedBy: skill.adaptedBy || null,
        changes: (skill.changes || []).map((c) => String(c).slice(0, 300)).slice(0, 12),
        tokens: F.tokens(skill.text),
        createdAt: old?.createdAt || now,
        updatedAt: now,
        uses: old?.uses || 0,
        lastUsedAt: old?.lastUsedAt || 0,
      };
      fs.writeFileSync(path.join(tmp, 'skill.json'), JSON.stringify(meta, null, 2));
      // Swapped in one step: a crash halfway leaves the old skill or the new one, never a mix.
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      cache = null;
      return meta;
    },
    update(name, patch) {
      const meta = { ...must(name) };
      if (patch.enabled !== undefined) meta.enabled = !!patch.enabled;
      if (patch.mode !== undefined) {
        if (!MODES.includes(patch.mode)) throw new UserError('Modo inválido');
        meta.mode = patch.mode;
      }
      if (patch.text !== undefined) {
        const text = String(patch.text);
        if (!text.trim()) throw new UserError('A skill não pode ficar vazia');
        fs.writeFileSync(path.join(dirOf(name), 'SKILL.md'), text);
        meta.description = String(F.parseSkill(text).data.description || meta.description).slice(0, 1024);
        meta.tokens = F.tokens(text);
      }
      meta.updatedAt = Date.now();
      return saveMeta(meta);
    },
    used(name) {
      const meta = get(name);
      if (!meta) return;
      saveMeta({ ...meta, uses: (meta.uses || 0) + 1, lastUsedAt: Date.now() });
    },
    remove(name) {
      must(name);
      fs.rmSync(dirOf(name), { recursive: true, force: true });
      cache = null;
    },
  };
}

module.exports = { createLibrary, safeRel, PROVIDERS, MODES };
