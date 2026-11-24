// Skills: the SKILL.md format, the library on disk, what each AI already has, GitHub links, the adaptation answer, the
// engine (import → draft → library) and what reaches a chat (catalog, /nome, the vesta-skills tools).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const F = require('../electron/skills/format.cjs');
const { createLibrary, safeRel } = require('../electron/skills/library.cjs');
const { scanNative } = require('../electron/skills/native.cjs');
const G = require('../electron/skills/github.cjs');
const S = require('../electron/skills/sources.cjs');
const { buildAdaptPrompt, parseAdaptReply } = require('../electron/skills/adapt.cjs');
const { createSkills } = require('../electron/skills/engine.cjs');
const { createSkillsMcp } = require('../electron/mcp/skills.cjs');
const { mcpTools, skillsServer } = require('../electron/ai/providers/mcp-servers.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-skills-'));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const SKILL = (name, desc, body = 'Faça com cuidado.') =>
  `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n${body}\n`;

test('format: front matter with quotes and folded blocks, names, token estimate', () => {
  const { data, body } = F.parseSkill(
    '---\nname: "Revisar Código"\ndescription: >-\n  Revisa o diff\n  antes do commit.\nlicense: MIT\n---\n\n# Corpo'
  );
  assert.equal(data.description, 'Revisa o diff antes do commit.');
  assert.equal(body, '# Corpo');
  assert.equal(F.skillName(data), 'revisar-codigo');
  assert.equal(F.skillName({}, '???'), '');
  assert.equal(F.parseSkill('sem front matter').data.name, undefined);
  const re = F.withFrontmatter('---\nname: a\ndescription: x\n---\n\nTexto', { name: 'b' });
  assert.deepEqual(F.parseSkill(re).data, { name: 'b', description: 'x' });
  assert.equal(F.tokens('x'.repeat(36)), 10);
  assert.ok(F.isScript('scripts/run.md') && F.isScript('a.py') && !F.isScript('refs/a.md'));
});

test('library: install, update, use count, read files, refuses duplicates and paths outside the skill', () => {
  const lib = createLibrary(tmp());
  const meta = lib.install({
    name: 'revisar',
    text: SKILL('revisar', 'Revisa o diff.'),
    files: [
      { path: 'refs/guia.md', text: '# Guia' },
      { path: '../fora.md', text: 'x' },
    ],
    original: { text: 'original', files: [] },
    source: { kind: 'github', label: 'dono/repo' },
    compat: { drael: 'precisa editar arquivos' },
  });
  assert.equal(meta.enabled, true);
  assert.equal(meta.mode, 'auto');
  assert.deepEqual(meta.compat, { claude: 'ok', codex: 'ok', opencode: 'ok', drael: 'precisa editar arquivos' });
  assert.throws(() => lib.install({ name: 'revisar', text: 'x' }), /Já existe/);
  assert.throws(() => lib.install({ name: 'Nome Ruim', text: 'x' }), /inválido/);
  const r = lib.read('revisar');
  assert.equal(r.original, 'original');
  assert.deepEqual(
    r.files.map((f) => f.path),
    ['refs/guia.md']
  );
  assert.equal(lib.readFile('revisar', 'refs/guia.md'), '# Guia');
  assert.throws(() => lib.readFile('revisar', '../skill.json'), /não encontrado/);
  assert.equal(safeRel('a/../../b'), null);
  lib.update('revisar', { enabled: false, mode: 'slash' });
  lib.used('revisar');
  // Updating from the source keeps the person's choices and the use count.
  const again = lib.install({ name: 'revisar', text: SKILL('revisar', 'Nova descrição.') }, { replace: true });
  assert.equal(again.enabled, false);
  assert.equal(again.mode, 'slash');
  assert.equal(again.uses, 1);
  assert.equal(again.description, 'Nova descrição.');
  lib.remove('revisar');
  assert.deepEqual(lib.list(), []);
});

test('native: Claude skills, newest plugin version, project skills and Codex, read only', () => {
  const home = tmp();
  write(path.join(home, '.claude', 'skills', 'quest', 'SKILL.md'), SKILL('quest', 'Conduz quests.'));
  const cache = path.join(home, '.claude', 'plugins', 'cache', 'mkt', 'potato');
  write(path.join(cache, '1.0.0', 'skills', 'velha', 'SKILL.md'), SKILL('velha', 'Antiga.'));
  write(path.join(cache, '2.0.0', 'skills', 'nova', 'SKILL.md'), SKILL('nova', 'Atual.'));
  fs.utimesSync(path.join(cache, '1.0.0'), new Date(2020, 1, 1), new Date(2020, 1, 1));
  const project = tmp();
  write(path.join(project, '.claude', 'skills', 'deploy', 'SKILL.md'), SKILL('deploy', 'Publica.'));
  write(path.join(home, '.codex', 'skills', '.system', 'imagegen', 'SKILL.md'), SKILL('imagegen', 'Gera imagens.'));
  const n = scanNative({ env: {}, home, projects: [{ name: 'App', path: project }] });
  assert.deepEqual(n.claude.map((s) => s.name).sort(), ['deploy', 'nova', 'quest']);
  assert.equal(n.claude.find((s) => s.name === 'nova').label, 'plugin potato');
  assert.equal(n.claude.find((s) => s.name === 'deploy').label, 'projeto App');
  assert.deepEqual(
    n.codex.map((s) => s.name),
    ['imagegen']
  );
  assert.deepEqual(n.opencode, []);
});

test('github: links to repositories, folders and files; a repository with several skills', async () => {
  assert.deepEqual(G.parseGithubUrl('https://github.com/cursor/plugins/tree/main/pstack'), {
    owner: 'cursor',
    repo: 'plugins',
    ref: 'main',
    path: 'pstack',
  });
  assert.equal(G.parseGithubUrl('https://github.com/a/b/blob/v1/skills/x/SKILL.md').path, 'skills/x');
  assert.equal(G.parseGithubUrl('https://raw.githubusercontent.com/a/b/main/s/SKILL.md').path, 's');
  assert.equal(G.parseGithubUrl('https://github.com/a/b').ref, null);
  assert.equal(G.parseGithubUrl('https://gitlab.com/a/b'), null);
  const files = {
    'pstack/skills/review/SKILL.md': SKILL('review', 'Revisa.'),
    'pstack/skills/review/refs/checklist.md': '- item',
    'pstack/skills/review/scripts/run.sh': 'echo',
    'pstack/skills/review/logo.png': 'bin',
    'pstack/skills/plan/SKILL.md': SKILL('plan', 'Planeja.'),
    'outro/SKILL.md': SKILL('fora', 'Fora do link.'),
  };
  const asked = [];
  const net = {
    json: async (e) => {
      asked.push(e);
      if (e === 'repos/cursor/plugins') return { default_branch: 'main', license: { spdx_id: 'MIT' } };
      return { tree: Object.entries(files).map(([p, t]) => ({ path: p, type: 'blob', size: t.length })) };
    },
    raw: async (o, r, ref, p) => files[p],
  };
  const r = await G.scanGithub('https://github.com/cursor/plugins/tree/main/pstack', net);
  assert.equal(r.label, 'cursor/plugins · pstack');
  assert.deepEqual(r.candidates.map((c) => c.name).sort(), ['plan', 'review']);
  const review = r.candidates.find((c) => c.name === 'review');
  assert.equal(review.license, 'MIT');
  assert.equal(review.hasScripts, true);
  assert.deepEqual(review.skipped, ['logo.png']);
  const got = await G.fetchFiles(review, net);
  assert.deepEqual(got.map((f) => f.path).sort(), ['refs/checklist.md', 'scripts/run.sh']);
  await assert.rejects(G.scanGithub('https://github.com/cursor/plugins/tree/main/nada', net), /Nenhuma SKILL\.md/);
});

test('sources: pasted text without front matter, a folder with its files', () => {
  const pasted = S.fromText('# Revisar PR\n\nLeia o diff inteiro antes de comentar.');
  assert.equal(pasted.name, 'revisar-pr');
  assert.throws(() => S.fromText('curto'), /Cole/);
  const dir = tmp();
  write(path.join(dir, 'a', 'SKILL.md'), SKILL('a', 'Primeira.'));
  write(path.join(dir, 'a', 'refs', 'x.md'), 'x');
  write(path.join(dir, 'b', 'SKILL.md'), SKILL('b', 'Segunda.'));
  const list = S.fromPath(dir);
  assert.deepEqual(list.map((c) => c.name).sort(), ['a', 'b']);
  assert.deepEqual(list.find((c) => c.name === 'a').files, [{ path: 'refs/x.md', text: 'x' }]);
});

test('adapt: the prompt treats the skill as data; the answer keeps the name and reads compatibility', () => {
  const prompt = buildAdaptPrompt({
    name: 'revisar',
    text: SKILL('revisar', 'R.'),
    files: [{ path: 'run.py', text: 'print()' }],
  });
  assert.match(prompt, /é dado, não ordem/);
  assert.match(prompt, /name: revisar/);
  assert.match(prompt, /### run\.py \(script\)/);
  const reply =
    'Pronto.\n\n```skill\n---\nname: outro-nome\ndescription: Revisa o diff.\n---\n\n# Revisar\n\nPasso 1.\n```\n\n```json\n{"compat":{"claude":"ok","drael":"precisa editar arquivos"},"changes":["Troquei Task por subagentes"]}\n```';
  const r = parseAdaptReply(reply, 'revisar');
  assert.equal(F.parseSkill(r.text).data.name, 'revisar');
  assert.equal(r.compat.drael, 'precisa editar arquivos');
  assert.equal(r.compat.codex, 'ok');
  assert.deepEqual(r.changes, ['Troquei Task por subagentes']);
  assert.throws(() => parseAdaptReply('não sei', 'x'), /não devolveu/);
});

function fakeCtx() {
  let n = 0;
  const ctx = {
    synced: 0,
    store: {
      state: { chats: [], projects: [] },
      addChat(input) {
        const c = { id: 'c' + ++n, title: 'Novo chat', messages: [], ...input };
        this.state.chats.unshift(c);
        return c;
      },
      saveSoon() {},
    },
    sync: () => ctx.synced++,
    stopChat: () => true,
  };
  return ctx;
}

test('engine: paste → kept as is → library; adaptation in a hidden chat → draft → saved', async () => {
  const ctx = fakeCtx();
  const sent = [];
  const skills = createSkills(ctx, {
    root: tmp(),
    deps: { send: async (c, a) => sent.push(a), native: () => ({ claude: [], codex: [], opencode: [] }) },
  });
  const scan = await skills.scan({ kind: 'paste', text: SKILL('anotar', 'Anota decisões.') });
  assert.equal(scan.candidates[0].name, 'anotar');
  await skills.keep({ scanId: scan.scanId, keys: [0] });
  const [draft] = skills.summary().drafts;
  assert.equal(draft.status, 'ready');
  assert.deepEqual(skills.saveDrafts({ ids: [draft.id] }), ['anotar']);
  assert.equal(skills.summary().list[0].adaptedBy, null);

  const scan2 = await skills.scan({ kind: 'paste', text: SKILL('revisar', 'Revisa.', 'Use a ferramenta Task.') });
  const [id] = await skills.adapt({ scanId: scan2.scanId, keys: [0], provider: 'codex' });
  const chat = ctx.store.state.chats[0];
  assert.equal(chat.skillDraft, id);
  assert.equal(chat.mode, 'read');
  assert.equal(chat.memory, false);
  await new Promise((r) => setImmediate(r));
  assert.match(sent[0].text, /Você vai adaptar uma skill/);
  chat.messages.push({
    role: 'assistant',
    text: '```skill\n---\nname: revisar\ndescription: Revisa.\n---\n\nAbra subagentes, se puder.\n```\n```json\n{"compat":{},"changes":["Task virou subagentes"]}\n```',
  });
  skills.onChatDone({ chatId: chat.id, status: 'done' });
  assert.equal(ctx.store.state.chats.length, 0, 'the adaptation chat is removed');
  const d = skills.draftRead(id);
  assert.equal(d.status, 'ready');
  assert.match(d.text, /subagentes/);
  assert.match(d.original, /Task/);
  skills.draftUpdate(id, { mode: 'slash' });
  skills.saveDrafts({ ids: [id] });
  const meta = skills.lib.get('revisar');
  assert.equal(meta.adaptedBy, 'codex');
  assert.equal(meta.mode, 'slash');
  assert.deepEqual(meta.changes, ['Task virou subagentes']);
  assert.match(skills.read('revisar').original, /Task/);

  // A failed adaptation becomes an error on the draft; nothing is installed.
  const scan3 = await skills.scan({ kind: 'paste', text: SKILL('falha', 'Falha.') });
  const [bad] = await skills.adapt({ scanId: scan3.scanId, keys: [0], provider: 'claude' });
  const c3 = ctx.store.state.chats[0];
  c3.messages.push({ role: 'assistant', text: '', error: 'Sem login' });
  skills.onChatDone({ chatId: c3.id, status: 'error' });
  assert.equal(skills.draftRead(bad).error, 'Sem login');
  skills.discard([bad]);
  assert.equal(skills.summary().drafts.length, 0);
});

test('engine: catalog lists only "A IA decide" skills the AI can use and does not have on its own; /nome expands', async () => {
  const ctx = fakeCtx();
  const skills = createSkills(ctx, {
    root: tmp(),
    deps: { native: () => ({ claude: [{ name: 'nativa' }], codex: [], opencode: [] }) },
  });
  const add = (name, extra = {}) =>
    skills.lib.install({
      name,
      text: SKILL(name, 'Sobre ' + name + '.'),
      files: [{ path: 'refs/a.md', text: 'a' }],
      ...extra,
    });
  add('auto');
  add('nativa');
  add('so-barra', { mode: 'slash' });
  add('sem-drael', { compat: { drael: 'precisa editar arquivos' } });
  add('desligada');
  skills.set('desligada', { enabled: false });
  const claude = { id: 'x', provider: 'claude' };
  const hint = skills.catalogHint(claude);
  assert.match(hint, /- auto: Sobre auto\./);
  assert.match(hint, /- sem-drael/);
  assert.doesNotMatch(hint, /nativa|so-barra|desligada/);
  assert.doesNotMatch(skills.catalogHint({ provider: 'drael' }), /sem-drael/);
  const e = skills.expand(claude, '/so-barra revise o login');
  assert.equal(e.skill, 'so-barra');
  assert.match(e.text, /<skill nome="so-barra">[\s\S]*Faça com cuidado\.[\s\S]*<\/skill>/);
  assert.match(e.text, /refs\/a\.md/);
  assert.match(e.text, /Pedido: revise o login/);
  assert.match(e.note.label, /Skill \/so-barra carregada/);
  assert.equal(skills.lib.get('so-barra').uses, 1);
  assert.match(skills.expand(claude, '/auto').text, /aplique esta skill agora/);
  assert.equal(skills.expand(claude, '/desligada x'), null);
  assert.equal(skills.expand(claude, '/inexistente'), null);
  assert.equal(skills.expand(claude, 'texto /auto'), null);
  // Only folders the native scan listed can be brought in.
  await assert.rejects(skills.scan({ kind: 'native', dir: 'C:\\Windows' }), /não encontrada/);
});

test('vesta-skills MCP: per-chat token, only usable skills, nothing for adaptation chats; every CLI gets it', async () => {
  const ctx = fakeCtx();
  const skills = createSkills(ctx, { root: tmp(), deps: { native: () => ({ claude: [], codex: [], opencode: [] }) } });
  const chat = { id: 'chat1', provider: 'opencode', messages: [] };
  const hidden = { id: 'chat2', provider: 'claude', skillDraft: 'd', messages: [] };
  ctx.store.state.chats.push(chat, hidden);
  const host = createSkillsMcp(ctx, { skills });
  try {
    assert.equal(await host.endpointFor(chat), null, 'no skill on: no server');
    skills.lib.install({ name: 'guia', text: SKILL('guia', 'Guia.'), files: [{ path: 'a.md', text: 'A' }] });
    assert.equal(await host.endpointFor(hidden), null);
    const ep = await host.endpointFor(chat);
    const rpc = async (method, params, token = ep.token) => {
      const r = await fetch(ep.mcp, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return r.status === 200 ? (await r.json()).result : r.status;
    };
    assert.equal(await rpc('tools/list', {}, 'errado'), 401);
    const tools = await rpc('tools/list', {});
    assert.deepEqual(
      tools.tools.map((t) => t.name),
      ['vesta_skills_list', 'vesta_skill_load', 'vesta_skill_find', 'vesta_skill_file']
    );
    assert.ok(
      tools.tools.every((t) => t.annotations?.readOnlyHint === true),
      'all read only: they work in Só consulta (Claude Code plan mode)'
    );
    const load = await rpc('tools/call', { name: 'vesta_skill_load', arguments: { name: 'guia' } });
    assert.deepEqual(JSON.parse(load.content[0].text).files, ['a.md']);
    const found = await rpc('tools/call', { name: 'vesta_skill_find', arguments: { name: 'GUIA' } });
    assert.equal(JSON.parse(found.content[0].text)[0].origem, 'Biblioteca do VeSTA');
    const none = await rpc('tools/call', { name: 'vesta_skill_find', arguments: { name: 'nada-disso' } });
    assert.equal(JSON.parse(none.content[0].text).encontrado, false);
    const file = await rpc('tools/call', {
      name: 'vesta_skill_file',
      arguments: { name: 'guia', path: '../skill.json' },
    });
    assert.equal(file.isError, true);
    skills.set('guia', { enabled: false });
    assert.equal(await rpc('tools/list', {}), 401, 'turning the last skill off closes the door');
  } finally {
    await host.close();
  }
  const server = skillsServer({ mcp: 'http://127.0.0.1:1/mcp', token: 't' });
  assert.ok(mcpTools('claude', [server]).args.includes('mcp__vesta-skills'));
  assert.ok(mcpTools('codex', [server]).args.some((a) => a.includes('mcp_servers.vesta-skills.bearer_token_env_var')));
  assert.match(mcpTools('opencode', [server]).env.OPENCODE_CONFIG_CONTENT, /vesta-skills/);
});

test('find: a skill by name in the library and in what each AI has, with its text and files', () => {
  const dir = path.join(tmp(), 'commit-pro');
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), SKILL('commit-pro', 'Escreve mensagens de commit.'));
  fs.writeFileSync(path.join(dir, 'refs', 'exemplos.md'), 'x');
  const native = () => ({
    claude: [
      {
        provider: 'claude',
        name: 'commit-pro',
        description: 'Escreve mensagens de commit.',
        label: '~/.claude/skills',
        dir,
      },
    ],
    codex: [],
    opencode: [],
  });
  const skills = createSkills(fakeCtx(), { root: tmp(), deps: { native } });
  skills.lib.install({
    name: 'commit',
    text: SKILL('commit', 'Commits curtos.'),
    files: [{ path: 'a.md', text: 'A' }],
  });
  const all = skills.find('commit');
  assert.deepEqual(
    all.map((x) => [x.ai, x.name]),
    [
      ['vesta', 'commit'],
      ['claude', 'commit-pro'],
    ],
    'the same name first, then names that contain it'
  );
  assert.match(all[0].text, /Commits curtos/);
  assert.deepEqual(all[0].files, ['a.md']);
  assert.match(all[1].text, /Escreve mensagens de commit/);
  assert.deepEqual(all[1].files, ['refs/exemplos.md']);
  assert.equal(all[1].origem, 'Claude Code · ~/.claude/skills');
  assert.deepEqual(
    skills.find('commit', 'claude').map((x) => x.name),
    ['commit-pro'],
    'only where the person said'
  );
  assert.deepEqual(
    skills.find('commit', 'Claude Code').map((x) => x.ai),
    ['claude']
  );
  assert.deepEqual(
    skills.find('mensagens').map((x) => x.name),
    ['commit-pro'],
    'by its description'
  );
  assert.deepEqual(skills.find('commit', 'gemini'), []);
  assert.deepEqual(skills.find(''), []);
});

test('screen logic: grouping by origin, filters, catalog cost, the "/" menu and the chip', async () => {
  const L = await import('../src/lib/skills.js');
  const list = [
    {
      name: 'tdd',
      description: 'Testes primeiro.',
      enabled: true,
      mode: 'auto',
      tokens: 900,
      source: { label: 'matt/skills', kind: 'github', url: 'u' },
    },
    {
      name: 'arena',
      description: 'Várias IAs.',
      enabled: false,
      mode: 'slash',
      tokens: 5000,
      source: { label: 'cursor/plugins · pstack', kind: 'github' },
    },
    {
      name: 'minha',
      description: 'Minha.',
      enabled: true,
      mode: 'slash',
      tokens: 100,
      source: { label: 'Criadas por você' },
    },
  ];
  assert.deepEqual(
    L.groupBySource(list).map((g) => g.label),
    ['cursor/plugins · pstack', 'matt/skills', 'Criadas por você']
  );
  assert.deepEqual(
    L.filterSkills(list, { filter: 'on' }).map((s) => s.name),
    ['tdd', 'minha']
  );
  assert.deepEqual(
    L.filterSkills(list, { filter: 'heavy' }).map((s) => s.name),
    ['arena']
  );
  assert.deepEqual(
    L.filterSkills(list, { query: 'primeiro' }).map((s) => s.name),
    ['tdd']
  );
  // Only enabled "A IA decide" skills go in the catalog.
  assert.deepEqual(L.budget(list), { on: 2, catalog: L.catalogTokens(list[0]) });
  assert.equal(L.slashMatches(list, 'oi'), null);
  assert.equal(L.slashMatches(list, '/tdd agora'), null, 'closes once the request starts');
  assert.deepEqual(
    L.slashMatches(list, '/').map((s) => s.name),
    ['tdd', 'minha']
  );
  assert.deepEqual(
    L.slashMatches(list, '/in').map((s) => s.name),
    ['minha']
  );
  assert.deepEqual(L.slashMatches(list, '/zzz'), []);
  assert.equal(L.splitSlash('/tdd revise o login', 'tdd').rest, 'revise o login');
  assert.equal(L.splitSlash('/tdd', 'tdd').rest, '');
  assert.equal(L.aiState({ compat: { drael: 'precisa editar' } }, 'drael').ok, false);
});
