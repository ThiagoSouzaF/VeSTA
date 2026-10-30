// Remote plan edits (updateStep / addStep / removeStep): argument validation and the full-access confirmation.
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  os = require('node:os');
const { createBus } = require('../electron/events.cjs');
const { validateArgs } = require('../electron/remote/allowlist.cjs');
const { createRemote } = require('../electron/remote/index.cjs');

const refused = (name, args, status = 400) =>
  assert.throws(
    () => validateArgs(name, args),
    (e) => e.status === status
  );

test('updateStep: accepts only known fields with valid types and drops the rest', () => {
  const out = validateArgs('updateStep', {
    id: 'q1',
    stepId: 's2',
    provider: 'codex',
    model: 'gpt-x',
    mode: 'read',
    dependsOn: ['s1'],
    status: 'done',
    chatId: 'x',
    by: 'hacker',
  });
  assert.deepEqual(out, { id: 'q1', stepId: 's2', provider: 'codex', model: 'gpt-x', mode: 'read', dependsOn: ['s1'] });
  refused('updateStep', { id: 'q1', stepId: 's2' }); // nothing to change
  refused('updateStep', { id: 'q1', provider: 'codex' }); // stepId required
  refused('updateStep', { id: 'q1', stepId: 's2', provider: 'gemini' });
  refused('updateStep', { id: 'q1', stepId: 's2', mode: 'root' });
  refused('updateStep', { id: 'q1', stepId: 's2', model: 'm'.repeat(121) });
  refused('updateStep', { id: 'q1', stepId: 's2', title: '  ' });
  refused('updateStep', { id: 'q1', stepId: 's2', instructions: 'x'.repeat(8001) });
  refused('updateStep', { id: 'q1', stepId: 's2', dependsOn: 's1' });
  refused('updateStep', { id: 'q1', stepId: 's2', dependsOn: [1] });
  refused('updateStep', { id: 'q1', stepId: 's2', dependsOn: Array(41).fill('s1') });
  refused('updateStep', { id: 5, stepId: 's2', provider: 'claude' });
});

test('addStep / removeStep validate ids, sizes and lists', () => {
  assert.deepEqual(validateArgs('addStep', { id: 'q1', title: 'T', provider: 'opencode', extra: 1 }), {
    id: 'q1',
    title: 'T',
    provider: 'opencode',
  });
  refused('addStep', { id: 'q1' }); // title required
  refused('addStep', { id: 'q1', title: 'T', provider: 'x' });
  refused('addStep', { id: 'q1', title: 'T', mode: 'sudo' });
  refused('addStep', { id: 'q1', title: 'T', dependsOn: ['../x'] });
  refused('addStep', { id: '../q', title: 'T' });
  assert.deepEqual(validateArgs('removeStep', { id: 'q1', stepId: 's1' }), { id: 'q1', stepId: 's1' });
  refused('removeStep', { id: 'q1' });
  refused('removeStep', { id: 'q1', stepId: {} });
});

function desktop(answers = []) {
  const bus = createBus();
  const store = {
    state: {
      remote: {},
      chats: [],
      quests: [
        {
          id: 'q1',
          title: 'Q',
          status: 'paused',
          steps: [
            { id: 's1', title: 'Ler', instructions: 'i', provider: 'claude', mode: 'ask', status: 'pending' },
            { id: 's2', title: 'Fazer', instructions: 'i', provider: 'claude', mode: 'edit', status: 'pending' },
          ],
        },
      ],
    },
    save() {},
  };
  const ctx = {
    store,
    bus,
    integrations: { claude: { installed: true } },
    state: () => ({ settings: {}, projects: [], chats: [], quests: store.state.quests }),
  };
  const done = [],
    asked = [];
  const rec = (n) => async (a) => (done.push([n, a]), {});
  const methods = { updateStep: rec('updateStep'), addStep: rec('addStep'), removeStep: rec('removeStep') };
  const remote = createRemote({
    ctx,
    methods,
    bus,
    staticRoot: os.tmpdir(),
    deps: {
      confirm: async (r) => (asked.push(r), answers.length ? answers.shift() : 'yes'),
      log: () => {},
      addresses: () => ({ tailscale: null }),
      tailscale: {
        status: async () => ({ installed: false, running: false, serving: false, httpsUrl: null }),
        serve: async () => ({ changed: false }),
        unserve: async () => ({ changed: false }),
      },
    },
  });
  return { remote, done, asked };
}
const c = { device: { id: 'd1', name: 'Pixel' }, ip: '100.64.0.9' };

test('updateStep: changing a step to full access asks at the desktop; ask/read and model-only edits do not', async () => {
  const d = desktop(['yes', 'no']);
  await d.remote.dispatch('updateStep', { id: 'q1', stepId: 's1', provider: 'codex' }, c);
  await d.remote.dispatch('updateStep', { id: 'q1', stepId: 's1', mode: 'read' }, c);
  await d.remote.dispatch('updateStep', { id: 'q1', stepId: 's2', model: 'opus' }, c); // already edit, same AI
  assert.equal(d.asked.length, 0);
  await d.remote.dispatch('updateStep', { id: 'q1', stepId: 's1', mode: 'edit' }, c);
  assert.equal(d.asked.length, 1);
  assert.match(d.asked[0].message, /etapa "Ler"/);
  // changing the AI of a step that is already edit changes what runs with full access: asks (and here: refused)
  await assert.rejects(
    d.remote.dispatch('updateStep', { id: 'q1', stepId: 's2', provider: 'codex' }, c),
    (e) => e.status === 403
  );
  assert.equal(d.asked.length, 2);
  assert.equal(d.done.filter(([n]) => n === 'updateStep').length, 4, 'refused one never reached the engine');
});

test('addStep: defaults to ask (Drael: read); explicit edit needs confirmation; removeStep never asks', async () => {
  const d = desktop(['no', 'yes']);
  await d.remote.dispatch('addStep', { id: 'q1', title: 'N' }, c);
  await d.remote.dispatch('addStep', { id: 'q1', title: 'D', provider: 'drael' }, c);
  assert.deepEqual(
    d.done.map(([, a]) => a.mode),
    ['ask', 'read']
  );
  assert.equal(d.asked.length, 0);
  await assert.rejects(
    d.remote.dispatch('addStep', { id: 'q1', title: 'E', mode: 'edit' }, c),
    (e) => e.status === 403
  );
  assert.equal(d.done.length, 2, 'refused: not added');
  await d.remote.dispatch('addStep', { id: 'q1', title: 'E', mode: 'edit' }, c);
  assert.equal(d.asked.length, 2);
  assert.equal(d.done.at(-1)[1].mode, 'edit');
  await d.remote.dispatch('removeStep', { id: 'q1', stepId: 's1' }, c);
  assert.equal(d.asked.length, 2);
});
