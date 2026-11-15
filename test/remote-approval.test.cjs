// The phone's full-access policy (electron/remote/approval.cjs): which calls ask the desktop, with which defaults, and
// when a quest stays approved.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { review, signature } = require('../electron/remote/approval.cjs');

const step = (id, mode, extra = {}) => ({
  id,
  title: 'Etapa ' + id,
  instructions: 'faça ' + id,
  provider: 'codex',
  mode,
  ...extra,
});
const state = () => ({
  chats: [
    { id: 'c-ask', title: 'Pede', mode: 'ask' },
    { id: 'c-edit', title: 'Livre', mode: 'edit' },
  ],
  quests: [
    { id: 'q1', title: 'Q', steps: [step('s1', 'edit'), step('s2', 'ask'), step('s3', 'edit', { status: 'done' })] },
    { id: 'q0', title: 'Leitura', steps: [step('r1', 'read')] },
  ],
});

test('which calls ask the desktop, and the defaults a phone call gets', () => {
  const none = new Map();
  const cases = [
    // [call, args, asks?, mode the call ends up with (when it has one)]
    ['createChat', { provider: 'codex' }, false, 'ask'],
    ['createChat', { provider: 'drael' }, false, 'read'],
    ['createChat', { provider: 'claude', mode: 'edit' }, true, 'edit'],
    ['createChat', { provider: 'claude', mode: 'turbo' }, false, 'ask'],
    ['updateChat', { id: 'c-ask', mode: 'edit' }, true],
    ['updateChat', { id: 'c-edit', mode: 'edit' }, false],
    ['updateChat', { id: 'c-ask', mode: 'read' }, false],
    ['createQuest', { title: 'N', steps: [{ title: 'a' }] }, false],
    ['createQuest', { title: 'N', steps: [{ title: 'a', mode: 'edit' }] }, true],
    ['startQuest', { id: 'q1' }, true],
    ['startQuest', { id: 'q0' }, false],
    ['resumeQuest', { id: 'q1' }, true],
    ['addStep', { id: 'q1', provider: 'drael' }, false, 'read'],
    ['addStep', { id: 'q1', provider: 'codex' }, false, 'ask'],
    ['addStep', { id: 'q1', provider: 'codex', mode: 'edit' }, true, 'edit'],
    ['updateStep', { id: 'q1', stepId: 's2', mode: 'edit' }, true],
    ['updateStep', { id: 'q1', stepId: 's1', instructions: 'outra coisa' }, true],
    ['updateStep', { id: 'q1', stepId: 's1', instructions: 'faça s1' }, false],
    ['updateStep', { id: 'q1', stepId: 's1', mode: 'read' }, false],
    ['sendMessage', { id: 'c-ask', text: 'oi' }, false],
  ];
  for (const [name, args, asks, mode] of cases) {
    const r = review(name, args, state(), none);
    assert.equal(!!r.ask, asks, name + ' ' + JSON.stringify(args));
    if (mode) assert.equal(r.args.mode, mode, name + ' ' + JSON.stringify(args));
  }
  const q = review('createQuest', { title: 'N', steps: [{ title: 'a' }, 'x'] }, state(), none);
  assert.deepEqual(q.args.steps, [{ title: 'a', mode: 'ask' }, 'x']);
});

test('a quest approved for its full-access steps starts again without asking, until they change', () => {
  const s = state();
  const approved = new Map();
  const start = review('startQuest', { id: 'q1' }, s, approved);
  assert.equal(start.rememberNow, 'q1');
  approved.set('q1', signature(s.quests[0]));
  assert.equal(review('retryStep', { id: 'q1' }, s, approved).ask, null);
  // Finished steps do not count; a changed full-access step does.
  s.quests[0].steps[2].title = 'mudou';
  assert.equal(review('startQuest', { id: 'q1' }, s, approved).ask, null);
  s.quests[0].steps[0].provider = 'claude';
  assert.ok(review('startQuest', { id: 'q1' }, s, approved).ask);
});

test('changing a step keeps the quest approved only if it was approved before the change', () => {
  const s = state();
  const approved = new Map([['q1', signature(s.quests[0])]]);
  assert.equal(review('updateStep', { id: 'q1', stepId: 's2', mode: 'edit' }, s, approved).rememberAfter, 'q1');
  assert.equal(review('updateStep', { id: 'q1', stepId: 's2', mode: 'edit' }, s, new Map()).rememberAfter, null);
  // The only full-access step being the one changed: nothing older is left unapproved.
  assert.equal(review('updateStep', { id: 'q1', stepId: 's1', title: 'novo' }, s, new Map()).rememberAfter, 'q1');
});
