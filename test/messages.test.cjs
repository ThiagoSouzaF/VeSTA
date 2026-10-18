const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
// The renderer module is ESM inside a CommonJS package; load its source through a data: URL.
const load = async () =>
  import(
    'data:text/javascript;base64,' +
      Buffer.from(fs.readFileSync(path.join(__dirname, '../src/lib/messages.js'))).toString('base64')
  );

test('text events append to the message text', async () => {
  const { patchMessage } = await load();
  const m = { id: 1, text: 'ab' };
  const out = patchMessage(m, { type: 'text', text: 'cd' });
  assert.equal(out.text, 'abcd');
  assert.equal(m.text, 'ab');
});

test('permission events insert, then merge by id', async () => {
  const { patchMessage } = await load();
  let m = patchMessage({}, { type: 'permission', permission: { id: 'p', status: 'pending', title: 't' } });
  assert.deepEqual(m.permissions, [{ id: 'p', status: 'pending', title: 't' }]);
  m = patchMessage(m, { type: 'permission', permission: { id: 'p', status: 'allowed' } });
  assert.deepEqual(m.permissions, [{ id: 'p', status: 'allowed', title: 't' }]);
});

test('activity events merge by id and append when unidentified', async () => {
  const { patchMessage } = await load();
  let m = patchMessage({}, { type: 'activity', activity: { id: 'a', status: 'running', label: 'L' } });
  m = patchMessage(m, { type: 'activity', activity: { id: 'a', status: 'done' } });
  m = patchMessage(m, { type: 'activity', activity: { label: 'no id' } });
  m = patchMessage(m, { type: 'activity', activity: { label: 'no id' } });
  assert.deepEqual(m.activities, [{ id: 'a', status: 'done', label: 'L' }, { label: 'no id' }, { label: 'no id' }]);
});

test('subagent events merge by toolUseId', async () => {
  const { patchMessage } = await load();
  let m = patchMessage({}, { type: 'subagent', subagent: { toolUseId: 't', status: 'running' } });
  m = patchMessage(m, { type: 'subagent', subagent: { toolUseId: 't', status: 'done' } });
  m = patchMessage(m, { type: 'subagent', subagent: { toolUseId: 'u', status: 'running' } });
  assert.deepEqual(m.subagents, [
    { toolUseId: 't', status: 'done' },
    { toolUseId: 'u', status: 'running' },
  ]);
});
