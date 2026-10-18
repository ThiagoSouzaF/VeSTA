const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { Memory } = require('../electron/memory.cjs');
(async () => {
  const dir = require('./test-scratch.cjs')('memory');
  const m = new Memory(path.resolve(__dirname, '../runtime/ai-memory.exe'), dir);
  try {
    await m.write({
      path: 'notas/alpha.md',
      title: 'Alpha',
      body: 'O identificador exclusivo é nebula7429.',
      kind: 'note',
      projectId: 'project-a',
    });
    await m.write({
      path: 'preferences/global.md',
      title: 'Idioma',
      body: 'Preferência global solarium9821: responder em português.',
      kind: 'preference',
    });
    const own = await m.query('nebula7429', 'project-a');
    assert.ok(own.includes('nebula7429'));
    const other = await m.query('nebula7429', 'project-b');
    assert.ok(!other.includes('O identificador exclusivo'));
    const global = await m.query('solarium9821', 'project-b');
    assert.ok(global.includes('solarium9821'));
    await m.remove({ path: 'notas/alpha.md', kind: 'note', projectId: 'project-a' });
    const deleted = await m.query('nebula7429', 'project-a');
    assert.ok(!deleted.includes('O identificador exclusivo'));
    console.log('PASS: AI Memory real — write, retrieval, project isolation, global preferences and deletion.');
  } finally {
    await m.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
