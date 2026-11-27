// Skills that ship with VeSTA: given once, never forced back or over the user's own; ui-revamp and explain-skill are
// well formed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const F = require('../electron/skills/format.cjs');
const { createLibrary } = require('../electron/skills/library.cjs');
const { seedBundled, readBundled, LABEL } = require('../electron/skills/bundled.cjs');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-bundled-' + p));
// A bundled folder with one skill "demo" at `version`.
function bundle(version, body = 'Faça assim.') {
  const dir = tmp('src-');
  fs.mkdirSync(path.join(dir, 'demo', 'files'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: Uma demo.\nversion: ' + version + '\n---\n\n' + body + '\n'
  );
  fs.writeFileSync(path.join(dir, 'demo', 'files', 'ref.md'), '# ref');
  return dir;
}

test('a bundled skill is installed once, as "Vem com o VeSTA", with its files', () => {
  const lib = createLibrary(tmp('lib-')),
    state = {};
  assert.deepEqual(seedBundled(lib, state, { dir: bundle(1) }), ['demo']);
  const s = lib.read('demo');
  assert.equal(s.meta.source.kind, 'vesta');
  assert.equal(s.meta.source.label, LABEL);
  assert.equal(s.meta.enabled, true);
  assert.deepEqual(
    s.files.map((f) => f.path),
    ['ref.md']
  );
  assert.deepEqual(state.bundledSkills, { demo: 1 });
  assert.deepEqual(seedBundled(lib, state, { dir: bundle(1) }), [], 'not again');
});

test('a removed bundled skill stays removed, also when a newer version ships', () => {
  const lib = createLibrary(tmp('lib-')),
    state = {};
  seedBundled(lib, state, { dir: bundle(1) });
  lib.remove('demo');
  assert.deepEqual(seedBundled(lib, state, { dir: bundle(1) }), []);
  assert.deepEqual(seedBundled(lib, state, { dir: bundle(2) }), []);
  assert.equal(lib.get('demo'), null);
});

test('a newer version replaces an untouched copy and leaves an edited one alone', () => {
  const lib = createLibrary(tmp('lib-')),
    state = {};
  seedBundled(lib, state, { dir: bundle(1) });
  lib.update('demo', { mode: 'slash' });
  assert.deepEqual(seedBundled(lib, state, { dir: bundle(2, 'Novo jeito.') }), ['demo']);
  assert.match(lib.read('demo').text, /Novo jeito/);
  assert.equal(lib.get('demo').mode, 'slash', 'the user’s choices are kept');
  lib.update('demo', { text: lib.read('demo').text + '\nMinha regra.' });
  assert.deepEqual(seedBundled(lib, state, { dir: bundle(3, 'Outro.') }), []);
  assert.match(lib.read('demo').text, /Minha regra/);
  assert.equal(state.bundledSkills.demo, 3);
});

test('a skill of the user with the same name is never replaced', () => {
  const lib = createLibrary(tmp('lib-')),
    state = {};
  lib.install({ name: 'demo', text: '---\nname: demo\ndescription: Minha.\n---\nMinha.', source: { kind: 'paste' } });
  assert.deepEqual(seedBundled(lib, state, { dir: bundle(1) }), []);
  assert.equal(lib.get('demo').description, 'Minha.');
});

test('ui-revamp ships well formed: name, description, the three sources and the colour question', () => {
  const b = readBundled().find((x) => x.name === 'ui-revamp');
  assert.ok(b, 'bundled');
  const { data, body } = F.parseSkill(b.text);
  assert.equal(data.name, 'ui-revamp');
  assert.ok(data.description.length > 40 && data.description.length < 1024);
  assert.ok(b.version >= 1);
  for (const site of ['TasteSkill', 'transitions.dev', 'React Bits']) assert.ok(body.includes(site), site);
  assert.match(body, /mantendo as cores/, 'asks about colours first');
  assert.match(body, /memory_query/, 'reads the shared memory');
  assert.match(body, /protótipo/, 'honours a prototype preference');
  const fontes = b.files.find((f) => f.path === 'fontes.md');
  assert.ok(fontes, 'fontes.md');
  for (const url of ['tasteskill.dev', 'transitions.dev', 'reactbits.dev']) assert.ok(fontes.text.includes(url), url);
  assert.ok(F.tokens(b.text) < 2500, 'stays short; the reference is in fontes.md');
});

test('explain-skill ships well formed: finds the skill anywhere, answers with a diagram, a picture and Detalhes', () => {
  const b = readBundled().find((x) => x.name === 'explain-skill');
  assert.ok(b, 'bundled');
  const { data, body } = F.parseSkill(b.text);
  assert.equal(data.name, 'explain-skill');
  assert.ok(data.description.length > 40 && data.description.length < 1024);
  assert.match(body, /vesta_skill_find/, 'reads skills through the find tool');
  assert.match(body, /~\/\.claude\/skills/, 'and knows where they live without it');
  for (const part of ['```mermaid', '```svg', '## Detalhes', '## Como funciona', '## Num relance'])
    assert.ok(body.includes(part), part);
  assert.match(body, /Nunca a execute/, 'explains, never runs the skill');
  assert.ok(F.tokens(b.text) < 2500, 'stays short');
});

test('ponytail ships whole: the four original texts with their MIT notice and a run that ends in a report', () => {
  const b = readBundled().find((x) => x.name === 'ponytail');
  assert.ok(b, 'bundled');
  const { data, body } = F.parseSkill(b.text);
  assert.equal(data.name, 'ponytail');
  assert.ok(data.description.length > 40 && data.description.length < 1024);
  const file = (p) => b.files.find((f) => f.path === p)?.text || '';
  for (const [p, name] of [
    ['regras.md', 'ponytail'],
    ['auditoria.md', 'ponytail-audit'],
    ['revisao.md', 'ponytail-review'],
    ['dividas.md', 'ponytail-debt'],
  ]) {
    assert.equal(F.parseSkill(file(p)).data.name, name, p + ' is the original');
    assert.ok(body.includes('`' + p + '`'), 'the run reads ' + p);
  }
  assert.match(file('LICENSE.md'), /MIT License[\s\S]*Permission is hereby granted/);
  assert.match(body, /vesta_skill_file/);
  assert.match(body, /mudanças não commitadas, pare/, 'never mixes with unsaved work');
  assert.match(body, /Nunca faça push, merge/);
  for (const part of ['### Corrigido', '### Depende de você', '### Não feito', '### Não checado'])
    assert.ok(body.includes(part), part);
  assert.ok(F.tokens(b.text) < 2500, 'stays short; the method is in the files');
});
