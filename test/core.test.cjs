const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { Store } = require('../electron/store.cjs');
const { command, parser } = require('../electron/providers.cjs');
const { redact, scope } = require('../electron/memory.cjs');
test('independent chats survive a restart without sharing session ids', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-test-'));
  const s = new Store(dir);
  const a = s.addChat({ provider: 'codex' }),
    b = s.addChat({ provider: 'codex' });
  a.sessionId = 'session-a';
  b.sessionId = 'session-b';
  a.messages.push({ role: 'user', text: 'Only A' });
  s.save();
  const restored = new Store(dir);
  assert.equal(restored.chat(a.id).sessionId, 'session-a');
  assert.equal(restored.chat(b.id).sessionId, 'session-b');
  assert.equal(restored.chat(b.id).messages.length, 0);
});
test('Codex resumes only the requested thread and keeps sandbox on', () => {
  const c = command({ provider: 'codex', sessionId: 'abc', mode: 'read' }, 'codex.exe');
  assert.equal(c.args[0], 'app-server');
  assert.equal(c.resume, 'abc');
  assert.deepEqual(c.thread, { approvalPolicy: 'never', sandbox: 'read-only' });
  assert.ok(!c.args.includes('--dangerously-bypass-approvals-and-sandbox'));
});
test('Claude keeps native settings and consumes streaming deltas once', () => {
  const c = command({ provider: 'claude', mode: 'read' }, 'claude.exe');
  assert.ok(c.args.includes('plan'));
  assert.ok(!c.args.includes('--safe-mode'));
  const events = [];
  const p = parser('claude', (e) => events.push(e));
  p.accept({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
  });
  p.accept({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } });
  p.accept({ type: 'result', result: 'Hello' });
  assert.equal(p.text, 'Hello');
});
test('OpenCode event identities prevent duplicate text and keep session', () => {
  const events = [];
  const p = parser('opencode', (e) => events.push(e));
  const e = { type: 'text', sessionID: 'ses_a', part: { id: 'p1', text: 'Olá' } };
  p.accept(e);
  p.accept(e);
  assert.equal(p.text, 'Olá');
  assert.ok(events.some((x) => x.sessionId === 'ses_a'));
});
test('project scope never becomes a global search; common keys are redacted', () => {
  assert.deepEqual(scope('p-a'), { workspace: 'vesta', project: 'p-a' });
  assert.deepEqual(scope(null), { workspace: 'vesta', project: 'inbox' });
  assert.equal(redact('token=very-secret'), 'token=[removido]');
  assert.ok(!redact('dk-01234567890123456789').includes('012345'));
});
