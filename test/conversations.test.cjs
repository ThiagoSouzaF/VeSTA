const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { Store } = require('../electron/app/store.cjs');
const { switchProvider, handoff } = require('../electron/chat/conversations.cjs');
test('switch preserves messages and authors, resets session, model and remembered permissions', () => {
  const s = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-switch-')));
  const c = s.addChat({ provider: 'codex', model: 'original', mode: 'ask' });
  c.sessionId = 'codex-session';
  c.permissionRules = ['cmd:npm'];
  c.messages = [
    { role: 'user', text: 'Question' },
    { role: 'assistant', status: 'done', text: 'Answer' },
  ];
  assert.equal(switchProvider(c, 'drael'), true);
  assert.equal(c.mode, 'read');
  assert.equal(c.sessionId, null);
  assert.equal(c.model, '');
  assert.deepEqual(c.permissionRules, []);
  assert.equal(c.messages[1].provider, 'codex');
  assert.equal(c.messages[1].model, 'original');
  assert.equal(c.messages.length, 2);
  c.messages.push({ role: 'assistant', status: 'done', provider: 'drael', text: 'Drael answer' });
  switchProvider(c, 'opencode');
  assert.equal(c.model, 'drael/drael-v1');
  assert.equal(c.messages[2].provider, 'drael');
  switchProvider(c, 'codex');
  assert.equal(c.sessionId, null);
  assert.equal(c.handoffPending, true);
  s.save();
  const restored = new Store(s.dir).chat(c.id);
  assert.equal(restored.provider, 'codex');
  assert.equal(restored.messages[1].provider, 'codex');
  assert.equal(restored.providerHistory[0].sessionId, 'codex-session');
});
test('invalid or oversized switches fail before mutations; same provider is a no-op', () => {
  const c = { provider: 'claude', sessionId: 'keep', messages: [], model: 'x' };
  assert.equal(switchProvider(c, 'claude'), false);
  assert.equal(c.sessionId, 'keep');
  assert.throws(() => switchProvider(c, 'invalid'), /inválida/);
  c.messages = [{ role: 'user', text: 'x'.repeat(120001) }];
  assert.throws(() => switchProvider(c, 'codex'), /120 mil/);
  assert.equal(c.provider, 'claude');
  assert.equal(c.sessionId, 'keep');
});
test('handoff transfers completed text with attribution, excludes partial failures and preserves current prompt', () => {
  const prompt = handoff(
    [
      { role: 'user', text: 'marker 7429' },
      { role: 'assistant', text: 'OK', provider: 'claude', status: 'done' },
      { role: 'assistant', text: 'partial failure', status: 'error' },
    ],
    'current prompt'
  );
  assert.match(prompt, /marker 7429/);
  assert.match(prompt, /claude/);
  assert.doesNotMatch(prompt, /partial failure/);
  assert.ok(prompt.endsWith('current prompt'));
});

test('moving a chat to another project: fresh native session, history in the next prompt, rules reset', () => {
  const { moveToProject, handoff } = require('../electron/chat/conversations.cjs');
  const chat = {
    provider: 'claude',
    model: 'claude-sonnet-5-5',
    projectId: 'p1',
    sessionId: 'sess-antiga',
    permissionRules: [{ tool: 'Bash', pattern: 'npm test' }],
    messages: [
      { role: 'user', text: 'Ajuste o login' },
      { role: 'assistant', text: 'Feito no arquivo auth.js', status: 'done' },
    ],
  };
  assert.equal(moveToProject(chat, 'p1'), false, 'same project: nothing changes');
  assert.equal(moveToProject(chat, 'p2'), true);
  assert.equal(chat.projectId, 'p2');
  assert.equal(chat.sessionId, null);
  assert.deepEqual(chat.permissionRules, []);
  assert.equal(chat.handoffPending, true);
  assert.equal(chat.handoffReason, 'project');
  assert.deepEqual(chat.providerHistory.at(-1).projectId, 'p1');
  assert.equal(chat.providerHistory.at(-1).sessionId, 'sess-antiga');
  const prompt = handoff(chat.messages, 'continue', chat.handoffReason);
  assert.match(prompt, /movida para outro projeto/);
  assert.match(prompt, /Ajuste o login/);
  assert.ok(prompt.endsWith('continue'));
  assert.equal(moveToProject(chat, null), true, 'to the Espaço pessoal');
  assert.equal(chat.projectId, null);
});

test('a moved chat with a huge history keeps its most recent messages instead of being blocked', () => {
  const { handoff } = require('../electron/chat/conversations.cjs');
  const big = 'x'.repeat(30000);
  const messages = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    text: i + big,
    status: 'done',
  }));
  messages.push({ role: 'user', text: 'ULTIMA-MENSAGEM' });
  assert.throws(() => handoff(messages, 'p'), /120 mil/, 'a switch of AI still refuses it');
  const prompt = handoff(messages, 'p', 'project');
  assert.match(prompt, /ULTIMA-MENSAGEM/);
  assert.ok(prompt.length < 125000);
});
