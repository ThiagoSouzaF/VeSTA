const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { command, history } = require('../electron/drael.cjs');
const { parser } = require('../electron/providers.cjs');
test('Drael cannot silently turn approval mode into full access', () => {
  assert.throws(() => command({ mode: 'ask' }, 'node.exe'), /aprovações/);
  assert.throws(() => command({ mode: 'read', model: 'another-model' }, 'node.exe'), /drael-v1/);
});
test('Drael history includes completed turns and omits failed partial output and current turn', () => {
  const prompt = history(
    [
      { role: 'user', text: 'earlier' },
      { role: 'assistant', text: 'complete', status: 'done' },
      { role: 'assistant', text: 'failed partial', status: 'error' },
      { role: 'user', text: 'now' },
      { role: 'assistant', text: '', status: 'running' },
    ],
    'current'
  );
  assert.match(prompt, /earlier/);
  assert.match(prompt, /complete/);
  assert.doesNotMatch(prompt, /failed partial|"now"/);
  assert.ok(prompt.endsWith('current'));
  assert.throws(() => history([{ role: 'user', text: 'x'.repeat(120001) }, {}, {}], 'current'), /excedeu/);
});
test('Drael streams once and reports tool failures, usage and turn exhaustion', () => {
  const events = [],
    p = parser('drael', (e) => events.push(e));
  p.accept({ type: 'text', text: 'Hello' });
  p.accept({ type: 'tool', name: 'vesta-memory__memory_query', args: { query: 'x' } });
  p.accept({ type: 'result', name: 'vesta-memory__memory_query', error: true, text: 'failure' });
  p.accept({ type: 'end', stopped: 'max_turns', usage: { input: 12, output: 3, cached: 4 } });
  assert.equal(p.text, 'Hello');
  assert.ok(events.some((e) => e.kind === 'memory' && e.status === 'error'));
  assert.ok(events.some((e) => e.type === 'cost' && e.inputTokens === 12));
  assert.ok(events.some((e) => e.type === 'provider-error'));
});
