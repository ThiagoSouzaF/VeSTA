// Tinta Mangá: default theme, the one-time migration, theme selection and the bundled fonts.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { Store, defaults, STORE_VERSION, THEMES, migrateStore } = require('../electron/app/store.cjs');
const { createMethods } = require('../electron/app/methods.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-theme-'));
const write = (dir, state) => fs.writeFileSync(path.join(dir, 'vesta.json'), JSON.stringify(state));
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'vesta.json'), 'utf8'));
const root = path.join(__dirname, '..');
const text = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('a new install uses Tinta Mangá', () => {
  assert.equal(defaults().settings.theme, 'ink');
  assert.equal(defaults().version, STORE_VERSION);
  assert.equal(new Store(tmp()).state.settings.theme, 'ink');
});

test('an existing install is moved to Tinta Mangá exactly once; afterwards the choice is respected', () => {
  const dir = tmp();
  write(dir, { version: 3, settings: { theme: 'paper', accent: 'mint', fontScale: 1.2 }, chats: [] });
  let s = new Store(dir);
  assert.equal(s.state.settings.theme, 'ink', 'migrated');
  assert.equal(s.state.settings.accent, 'mint', 'other settings are kept');
  assert.equal(s.state.settings.fontScale, 1.2);
  assert.equal(s.state.version, STORE_VERSION);
  assert.equal(read(dir).settings.theme, 'ink', 'the migration is written to disk');
  assert.equal(read(dir).version, STORE_VERSION);
  // the user picks another theme; a restart must not undo it
  s.state.settings.theme = 'aurora';
  s.save();
  s = new Store(dir);
  assert.equal(s.state.settings.theme, 'aurora');
  s = new Store(dir);
  assert.equal(s.state.settings.theme, 'aurora', 'and again');
});

test('old stores without a version or theme migrate too, and migrateStore leaves current stores alone', () => {
  const dir = tmp();
  write(dir, { chats: [], settings: {} });
  assert.equal(new Store(dir).state.settings.theme, 'ink');
  const state = { settings: { theme: 'obsidian' } };
  assert.equal(migrateStore(state, STORE_VERSION).settings.theme, 'obsidian');
  assert.equal(migrateStore(state, 3).settings.theme, 'ink');
});

test('theme selection accepts the four themes and rejects anything else', () => {
  assert.deepEqual(THEMES, ['ink', 'obsidian', 'aurora', 'paper']);
  const dir = tmp();
  const store = new Store(dir);
  const ctx = {
    store,
    sync() {},
    state: () => store.state,
    jobs: new Map(),
    app: { getPath: () => dir, getVersion: () => '0' },
    bounded: (v) => v,
  };
  const { saveSettings } = createMethods(ctx);
  for (const theme of THEMES) {
    saveSettings({ theme });
    assert.equal(store.state.settings.theme, theme);
  }
  saveSettings({ theme: 'neon' });
  assert.equal(store.state.settings.theme, 'paper', 'an unknown theme is ignored');
  saveSettings({ theme: 'ink', background: 'inkrain' });
  assert.equal(store.state.settings.background, 'inkrain');
  saveSettings({ background: 'plasma' });
  assert.equal(store.state.settings.background, 'inkrain', 'an unknown background is ignored');
});

test('the Tinta Mangá fonts are bundled locally with pinned versions and only the weights in use', () => {
  const pkg = JSON.parse(text('package.json'));
  for (const name of ['@fontsource/space-grotesk', '@fontsource/space-mono'])
    assert.match(pkg.dependencies[name], /^\d+\.\d+\.\d+$/, name + ' pinned to an exact version');
  const imports = (file) => [...text(file).matchAll(/@import '(@fontsource\/[^']+)'/g)].map((m) => m[1]);
  const wanted = [
    '@fontsource/space-grotesk/latin-400.css',
    '@fontsource/space-grotesk/latin-600.css',
    '@fontsource/space-grotesk/latin-700.css',
    '@fontsource/space-mono/latin-400.css',
    '@fontsource/space-mono/latin-700.css',
  ];
  assert.deepEqual(imports('src/styles/ink-fonts.css'), wanted);
  assert.ok(text('src/styles/index.css').includes("@import './ink-fonts.css'"));
  assert.ok(text('mobile/src/main.jsx').includes('ink-fonts.css'), 'the phone loads them too');
  for (const file of wanted) assert.ok(fs.existsSync(path.join(root, 'node_modules', file)), file + ' installed');
  const css = text('src/styles/theme-ink.css');
  assert.match(css, /--font-body:\s*'Space Grotesk'/);
  assert.match(css, /--font-mono:\s*'Space Mono'/);
  assert.ok(!/https?:\/\//.test(css + text('src/styles/ink-fonts.css')), 'no remote fonts');
});

// Spread between the strongest and the weakest channel of every hex colour in `css`.
const spreads = (css) =>
  [...css.matchAll(/#([0-9a-f]{3,8})\b/gi)].map(([, c]) => {
    const hex = c.length <= 4 ? c.replace(/./g, (d) => d + d) : c;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return ['#' + c, Math.max(r, g, b) - Math.min(r, g, b)];
  });
const PAPER = /:root\[data-theme='paper'\] \{[^}]*\}/;

test('the ink look uses only neutral greys (Papel: warm paper tones) and square corners', () => {
  const files = ['src/styles/theme-ink.css', 'src/styles/theme-ink-shared.css', 'src/styles/theme-ink-desktop.css'];
  files.push('mobile/src/theme-ink.css');
  for (const file of files) {
    const css = text(file);
    // docs/DESIGN.md's neutrals (zinc: #0a0a0c, #27272a, #52525b, #a1a1aa...) lean a hair cool; nothing more coloured.
    for (const [c, spread] of spreads(css.replace(PAPER, '')))
      assert.ok(spread <= 9, file + ': ' + c + ' is not a neutral grey');
    assert.ok(!/border-radius:\s*[1-9]/.test(css), file + ': a rounded corner');
  }
  // Papel is the same drawing on cream paper: its tokens may lean warm, never into a colour.
  const paper = PAPER.exec(text('src/styles/theme-ink.css'))?.[0];
  assert.ok(paper, 'Papel has its own tokens');
  for (const [c, spread] of spreads(paper)) assert.ok(spread <= 24, 'Papel: ' + c + ' is a colour, not paper');
  assert.match(text('src/styles/theme-ink.css'), /border-radius:\s*0\s*!important/);
  // The rules draw with the tokens, so the same rules serve Tinta and Papel.
  for (const file of files.slice(1)) assert.ok(!/data-theme='ink'/.test(text(file)), file + ': a rule only for Tinta');
});

test('v5: Gemini chats are dropped once, and quests forget them', () => {
  const dir = tmp();
  write(dir, {
    version: 4,
    settings: { theme: 'paper' },
    chats: [
      { id: 'a', provider: 'claude', messages: [] },
      { id: 'g', provider: 'gemini', messages: [] },
    ],
    quests: [
      {
        id: 'q',
        title: 'Q',
        leadChatId: 'g',
        steps: [{ id: 's1', title: 'S', instructions: 'i', provider: 'gemini', chatId: 'g' }],
      },
    ],
  });
  const s = new Store(dir);
  assert.deepEqual(
    s.state.chats.map((c) => c.id),
    ['a']
  );
  assert.equal(s.state.quests[0].leadChatId, null);
  assert.equal(s.state.quests[0].steps[0].chatId, null);
  assert.equal(s.state.quests[0].steps[0].provider, 'claude');
  assert.equal(s.state.settings.theme, 'paper', 'the v4 theme move is not repeated');
  assert.deepEqual(
    read(dir).chats.map((c) => c.id),
    ['a'],
    'written to disk'
  );
});
