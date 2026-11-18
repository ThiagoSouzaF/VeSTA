// Skills that come with VeSTA: electron/skills/bundled/<name>/SKILL.md (frontmatter `version: N`) plus files/**.
// Each one goes into the library once, grouped as "Vem com o VeSTA". state.bundledSkills remembers the version
// given, so a skill the user removed stays removed, a skill of theirs with the same name is never touched, and a
// newer version replaces only a copy they never edited (its SKILL.md still equals the original it was given).
const fs = require('node:fs'),
  path = require('node:path');
const F = require('./format.cjs');

const DIR = path.join(__dirname, 'bundled');
const LABEL = 'Vem com o VeSTA';

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push({ path: path.relative(base, p).replace(/\\/g, '/'), text: fs.readFileSync(p, 'utf8') });
  }
  return out;
}

function readBundled(dir = DIR) {
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && F.NAME.test(e.name));
  } catch {
    return [];
  }
  return names.map(({ name }) => {
    const text = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8');
    const files = fs.existsSync(path.join(dir, name, 'files')) ? walk(path.join(dir, name, 'files')) : [];
    return { name, text, files, version: Number(F.parseSkill(text).data.version) || 1 };
  });
}

// Returns the names installed or updated now.
function seedBundled(lib, state, { dir = DIR } = {}) {
  const given = (state.bundledSkills ||= {});
  const done = [];
  for (const b of readBundled(dir)) {
    const had = given[b.name],
      cur = lib.get(b.name);
    if (had !== undefined && b.version <= had) continue;
    if (had === undefined && cur) {
      given[b.name] = b.version; // the user already has a skill with this name: theirs stays
      continue;
    }
    if (had !== undefined) {
      const mine = cur?.source?.kind === 'vesta' && lib.read(b.name).text === lib.read(b.name).original;
      given[b.name] = b.version;
      if (!mine) continue; // removed or edited: the newer version is not forced on them
    }
    lib.install(
      {
        name: b.name,
        text: b.text,
        files: b.files,
        original: { text: b.text, files: [] },
        source: { kind: 'vesta', label: LABEL },
        mode: 'auto',
      },
      { replace: true }
    );
    given[b.name] = b.version;
    done.push(b.name);
  }
  return done;
}

module.exports = { seedBundled, readBundled, LABEL };
