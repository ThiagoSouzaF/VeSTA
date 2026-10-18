// Pure renderer logic (zoom, stream batching, usage view) loaded as ES modules from src/lib.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const lib = (name) => import('../src/lib/' + name + '.js');

test('zoom clamps to 80%..160% in 10% steps and never drifts', async () => {
  const z = await lib('zoom');
  assert.equal(z.clampScale(0.3), 0.8);
  assert.equal(z.clampScale(9), 1.6);
  assert.equal(z.clampScale(1.04), 1);
  assert.equal(z.clampScale('abc'), 1);
  assert.equal(z.clampScale(undefined), 1);
  let s = 1;
  for (let i = 0; i < 3; i++) s = z.stepScale(s, 1);
  assert.equal(s, 1.3, 'three steps up is exactly 1.3, no float noise');
  for (let i = 0; i < 20; i++) s = z.stepScale(s, 1);
  assert.equal(s, 1.6);
  for (let i = 0; i < 20; i++) s = z.stepScale(s, -1);
  assert.equal(s, 0.8);
  assert.equal(z.stepScale(1.4, 0), 1);
  assert.equal(z.scalePercent(1.1), '110%');
  assert.equal(z.scalePercent(0.8), '80%');
});

test('zoom shortcuts: Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 and Ctrl+wheel', async () => {
  const z = await lib('zoom');
  const k = (key, extra = {}) => z.zoomKey({ ctrlKey: true, key, ...extra });
  assert.equal(k('='), 1);
  assert.equal(k('+'), 1);
  assert.equal(k('-'), -1);
  assert.equal(k('0'), 0);
  assert.equal(k('a'), null);
  assert.equal(z.zoomKey({ ctrlKey: false, key: '=' }), null);
  assert.equal(k('=', { altKey: true }), null);
  assert.equal(z.zoomKey({ metaKey: true, key: '-' }), -1);
  assert.equal(z.zoomWheel({ ctrlKey: true, deltaY: -100 }), 1);
  assert.equal(z.zoomWheel({ ctrlKey: true, deltaY: 100 }), -1);
  assert.equal(z.zoomWheel({ ctrlKey: false, deltaY: 100 }), null);
  assert.equal(z.zoomWheel({ ctrlKey: true, deltaY: 0 }), null);
});

test('saveSettings keeps fontScale inside the allowed range', () => {
  const { clampFontScale } = require('../electron/methods.cjs');
  assert.equal(clampFontScale(1.26), 1.3);
  assert.equal(clampFontScale(5), 1.6);
  assert.equal(clampFontScale(0), 0.8);
});

const chats = () => [
  {
    id: 'c1',
    messages: [
      { id: 'm0', role: 'user', text: 'oi' },
      { id: 'm1', role: 'assistant', text: '', activities: [], subagents: [] },
    ],
  },
  { id: 'c2', messages: [{ id: 'x', role: 'assistant', text: 'outro' }] },
];
const text = (t, chatId = 'c1', messageId = 'm1') => ({ type: 'text', chatId, messageId, text: t });

test('applyEvents joins text deltas, keeps the order of activities and the identity of untouched chats/messages', async () => {
  const { applyEvents } = await lib('streamBuffer');
  const before = chats();
  const out = applyEvents(before, [
    text('Olá'),
    { type: 'activity', chatId: 'c1', messageId: 'm1', activity: { id: 'a', label: 'rodando', status: 'running' } },
    text(', mundo'),
    { type: 'activity', chatId: 'c1', messageId: 'm1', activity: { id: 'a', label: 'pronto', status: 'done' } },
    { type: 'subagent', chatId: 'c1', messageId: 'm1', subagent: { toolUseId: 't', status: 'running' } },
    { type: 'permission', chatId: 'c1', messageId: 'm1', permission: { id: 'p', status: 'pending' } },
  ]);
  const m = out[0].messages[1];
  assert.equal(m.text, 'Olá, mundo');
  assert.deepEqual(m.activities, [{ id: 'a', label: 'pronto', status: 'done' }]);
  assert.equal(m.subagents.length, 1);
  assert.equal(m.permissions[0].status, 'pending');
  assert.equal(out[1], before[1], 'another chat is the same object');
  assert.equal(out[0].messages[0], before[0].messages[0], 'another message is the same object');
  assert.equal(before[0].messages[1].text, '', 'the input is not mutated');
});

test('applying a batch equals applying the events one by one', async () => {
  const { applyEvents } = await lib('streamBuffer');
  const { patchMessage } = await lib('messages');
  const events = [];
  for (let i = 0; i < 300; i++) {
    events.push(text('t' + i + ' '));
    if (i % 7 === 0)
      events.push({
        type: 'activity',
        chatId: 'c1',
        messageId: 'm1',
        activity: { id: 'a' + (i % 5), label: 'l' + i, status: i % 2 ? 'running' : 'done' },
      });
    if (i % 11 === 0) events.push(text('outro ', 'c2', 'x'));
  }
  const batch = applyEvents(chats(), events);
  let seq = chats();
  for (const e of events)
    seq = seq.map((c) =>
      c.id !== e.chatId ? c : { ...c, messages: c.messages.map((m) => (m.id !== e.messageId ? m : patchMessage(m, e))) }
    );
  assert.deepEqual(batch, seq);
});

test('applyEvents returns the same array for events of unknown chats or none', async () => {
  const { applyEvents } = await lib('streamBuffer');
  const before = chats();
  assert.equal(applyEvents(before, []), before);
  assert.equal(applyEvents(before, [text('x', 'nope')]), before);
  assert.equal(applyEvents(before, [text('x', 'c1', 'nope')]), before);
});

test('the event buffer applies once per frame, flushes on demand and discards stale events', async () => {
  const { createEventBuffer } = await lib('streamBuffer');
  const frames = [];
  const applied = [];
  const buf = createEventBuffer((b) => applied.push(b.map((e) => e.n)), {
    schedule: (fn) => frames.push(fn) && frames.length,
    cancel: (h) => (frames[h - 1] = null),
  });
  for (let i = 0; i < 2000; i++) buf.push({ n: i });
  assert.equal(frames.length, 1, 'one frame scheduled for 2000 events');
  assert.equal(applied.length, 0);
  frames[0]();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].length, 2000);
  buf.push({ n: 'a' });
  assert.equal(frames.length, 2, 'a new frame after the previous one ran');
  buf.flush();
  assert.deepEqual(applied.at(-1), ['a']);
  buf.push({ n: 'b' });
  buf.discard();
  assert.equal(buf.size, 0);
  const n = applied.length;
  frames.at(-1)?.();
  assert.equal(applied.length, n, 'a discarded batch is never applied');
  buf.push({ n: 'c' });
  assert.equal(buf.size, 1);
});

test('usage view: percent of a window, zero once it reset, null without data', async () => {
  const { windowPercent, USAGE_PROVIDERS } = await lib('usageView');
  assert.equal(windowPercent({ utilization: 0.456, resetsAt: 2000 }, 1000), 46);
  assert.equal(windowPercent({ utilization: 0.9, resetsAt: 500 }, 1000), 0);
  assert.equal(windowPercent({ utilization: 0.9, resetsAt: null }, 1000), 90);
  assert.equal(windowPercent({ utilization: null }, 1000), null);
  assert.equal(windowPercent(null, 1000), null);
  assert.deepEqual(USAGE_PROVIDERS.order, ['codex', 'claude', 'drael', 'opencode']);
  assert.ok(USAGE_PROVIDERS.codex.windows && USAGE_PROVIDERS.claude.windows);
  assert.equal(USAGE_PROVIDERS.drael.windows, null);
});

test('markdown blocks join into exactly what marked.parse renders, and unchanged blocks are cached', async () => {
  const { markdownBlocks } = await lib('markdown');
  const { marked } = await import('marked');
  const docs = [
    '',
    'só um parágrafo\ncom quebra',
    '# Título\n\nparágrafo **negrito** e `código`.\n\n- a\n- b\n  - c\n\n1. um\n2. dois\n\n> citação\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
    '```js\nconst x = 1;\n\nconst y = 2;\n```\n\ndepois do código',
    '- item solto\n\n- outro item solto\n\ntexto final',
    'ref [link][1]\n\n[1]: https://exemplo.com',
    '```js\ncódigo sem fechar\n\nainda dentro',
  ];
  for (const doc of docs) {
    const joined = markdownBlocks(doc, (h) => h, new Map()).join('');
    assert.equal(
      joined.replace(/\n/g, ''),
      marked.parse(doc, { breaks: true }).replace(/\n/g, ''),
      JSON.stringify(doc)
    );
  }
  const store = new Map();
  let calls = 0;
  const count = (h) => (calls++, h);
  const base = 'primeiro bloco\n\nsegundo bloco\n\n';
  markdownBlocks(base + 'terceiro em curs', count, store);
  const first = calls;
  markdownBlocks(base + 'terceiro em curso ainda', count, store);
  assert.equal(calls - first, 1, 'only the block that changed is rendered again');
});
