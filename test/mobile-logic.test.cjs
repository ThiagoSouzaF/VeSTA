// Pure logic of the phone app (mobile/src/lib/state.js), loaded as an ES module.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const lib = () => import('../mobile/src/lib/state.js');

const msg = (id, role, extra = {}) => ({ id, role, text: id, createdAt: 1000, ...extra });
const chat = (id, messages = [], extra = {}) => ({
  id,
  title: id,
  provider: 'claude',
  model: '',
  mode: 'edit',
  updatedAt: 1,
  messages,
  ...extra,
});
const start = (chats = []) => ({ state: { settings: {}, projects: [], chats, quests: [], running: [] }, done: {} });

test('mergeState: partial snapshot replaces changed chats, keeps identity of the others, follows the order', async () => {
  const { mergeState } = await lib();
  const a = chat('a'),
    b = chat('b');
  const { state, missing } = mergeState(start([a, b]).state, {
    type: 'state',
    partial: true,
    chatIds: ['c', 'b', 'a'],
    chats: [chat('c')],
    running: ['c'],
    quests: [{ id: 'q' }],
  });
  assert.equal(missing, false);
  assert.deepEqual(
    state.chats.map((c) => c.id),
    ['c', 'b', 'a']
  );
  assert.equal(state.chats[1], b);
  assert.equal(state.chats[2], a);
  assert.deepEqual(state.running, ['c']);
  assert.equal(state.quests.length, 1);
  assert.equal(state.partial, undefined);
});

test('mergeState: a chat the client never received asks for a reload and changes nothing', async () => {
  const { mergeState } = await lib();
  const prev = start([chat('a')]).state;
  const r = mergeState(prev, { chatIds: ['a', 'ghost'], chats: [] });
  assert.equal(r.missing, true);
  assert.equal(r.state.chats, prev.chats);
});

test('reduceEvents keeps order: deltas, then the snapshot that contains them, then more deltas', async () => {
  const { reduceEvents } = await lib();
  const a = chat('a', [msg('u', 'user'), msg('m', 'assistant', { text: '', status: 'running' })]);
  const r = reduceEvents(start([a]), [
    { type: 'text', chatId: 'a', messageId: 'm', text: 'Olá' },
    { type: 'text', chatId: 'a', messageId: 'm', text: ' mundo' },
    {
      type: 'state',
      partial: true,
      chatIds: ['a'],
      chats: [chat('a', [msg('u', 'user'), msg('m', 'assistant', { text: 'Olá mundo!', status: 'done' })])],
      running: [],
    },
    { type: 'text', chatId: 'a', messageId: 'm', text: '??' },
    { type: 'chat-done', chatId: 'a', status: 'done' },
  ]);
  assert.equal(r.state.chats[0].messages[1].text, 'Olá mundo!??');
  assert.equal(r.done.a.status, 'done');
  assert.equal(r.missing, false);
});

test('reduceEvents applies permission and activity events with the desktop reducer', async () => {
  const { reduceEvents, pendingPermissions } = await lib();
  const a = chat('a', [msg('u', 'user'), msg('m', 'assistant', { status: 'running' })]);
  const r = reduceEvents(start([a]), [
    {
      type: 'activity',
      chatId: 'a',
      messageId: 'm',
      activity: { id: 'x', kind: 'command', label: 'npm test', status: 'running' },
    },
    {
      type: 'permission',
      chatId: 'a',
      messageId: 'm',
      permission: { id: 'p1', status: 'pending', createdAt: 5, command: 'ls' },
    },
  ]);
  assert.equal(r.state.chats[0].messages[1].activities.length, 1);
  const pending = pendingPermissions(r.state.chats);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].permission.id, 'p1');
  const answered = reduceEvents(r, [
    { type: 'permission', chatId: 'a', messageId: 'm', permission: { id: 'p1', status: 'allowed' } },
  ]);
  assert.equal(pendingPermissions(answered.state.chats).length, 0);
  // untouched chats keep their identity (no needless re-render)
  const b = chat('b');
  const two = reduceEvents(start([a, b]), [{ type: 'text', chatId: 'a', messageId: 'm', text: 'x' }]);
  assert.equal(two.state.chats[1], b);
});

test('pendingPermissions lists newest first across chats', async () => {
  const { pendingPermissions } = await lib();
  const mk = (id, at) =>
    chat(id, [msg('m' + id, 'assistant', { permissions: [{ id: 'p' + id, status: 'pending', createdAt: at }] })]);
  assert.deepEqual(
    pendingPermissions([mk('a', 1), mk('b', 9), mk('c', 5)]).map((x) => x.permission.id),
    ['pb', 'pc', 'pa']
  );
});

test('mascot moods follow what the AIs are doing', async () => {
  const { chatMood } = await lib();
  const now = 10_000_000;
  const thinking = chat('t', [msg('u', 'user'), msg('a', 'assistant', { text: '', status: 'running' })]);
  const working = chat('w', [msg('u', 'user'), msg('a', 'assistant', { text: 'x', status: 'running' })]);
  assert.equal(chatMood(thinking, { running: true, now }), 'thinking');
  assert.equal(chatMood(working, { running: true, now }), 'working');
  assert.equal(chatMood(working, { running: true, waiting: true, now }), 'thinking');
  const done = chat('d', [msg('a', 'assistant', { status: 'done', createdAt: now - 1000 })]);
  assert.equal(chatMood(done, { now }), 'success');
  assert.equal(
    chatMood(chat('d', [msg('a', 'assistant', { status: 'done', createdAt: now - 10 * 60000 })]), { now }),
    'idle'
  );
  const failed = chat('e', [msg('a', 'assistant', { status: 'error', createdAt: now - 1000 })]);
  assert.equal(chatMood(failed, { now }), 'error');
  assert.equal(chatMood(chat('x'), { now }), 'idle');
});

test('router and pairing fragment parsing', async () => {
  const { parseRoute, pairingCode, snippet } = await lib();
  assert.deepEqual(parseRoute(''), { name: 'chats', id: null });
  assert.deepEqual(parseRoute('#/chat/abc-123'), { name: 'chat', id: 'abc-123' });
  assert.deepEqual(parseRoute('#/atividade'), { name: 'atividade', id: null });
  assert.deepEqual(parseRoute('#/quest/q1'), { name: 'quest', id: 'q1' });
  assert.deepEqual(parseRoute('#/hack/<script>'), { name: 'chats', id: null });
  const code = 'A'.repeat(24);
  assert.equal(pairingCode('#pair=' + code), code);
  assert.equal(pairingCode('#pair=short'), '');
  assert.equal(pairingCode('#pair=' + code + '&x=1'), '');
  assert.equal(pairingCode(''), '');
  assert.equal(snippet(chat('s', [msg('1', 'user', { text: '**Oi**\n\n  tudo bem?' })])), 'Oi tudo bem?');
  assert.equal(snippet(chat('s', [msg('1', 'user', { text: 'x'.repeat(200) })]), 20).length, 20);
});
