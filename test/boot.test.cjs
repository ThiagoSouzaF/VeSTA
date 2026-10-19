// Real boot progress of the splash (electron/boot.cjs): pure logic, no electron.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const boot = require('../electron/boot.cjs');

test('stage weights add up to the whole bar and the labels are the splash captions', () => {
  assert.equal(
    boot.STAGES.reduce((n, s) => n + s.weight, 0),
    100
  );
  assert.deepEqual(
    boot.STAGES.map((s) => s.label),
    ['CARREGANDO DADOS', 'INICIANDO MEMÓRIA', 'PROCURANDO IAS', 'ABRINDO A INTERFACE']
  );
  assert.equal(boot.READY_LABEL, 'PRONTO');
});

test('snapshot: nothing done starts at 0% on the first stage; each finished stage adds its weight', () => {
  const s0 = boot.snapshot([]);
  assert.equal(s0.percent, 0);
  assert.equal(s0.label, 'CARREGANDO DADOS');
  assert.equal(s0.complete, false);
  assert.deepEqual(
    s0.steps.map((s) => s.done),
    [false, false, false, false]
  );
  const s1 = boot.snapshot(['data']);
  assert.equal(s1.percent, 15);
  assert.equal(s1.label, 'INICIANDO MEMÓRIA');
  // stages can finish in any order: the label stays on the first unfinished one
  const s2 = boot.snapshot(['data', 'ias', 'ui']);
  assert.equal(s2.percent, 70);
  assert.equal(s2.label, 'INICIANDO MEMÓRIA');
  const all = boot.snapshot(['data', 'memory', 'ias', 'ui']);
  assert.equal(all.percent, 100);
  assert.equal(all.label, 'PRONTO');
  assert.equal(all.complete, true);
});

test('snapshot of a failure shows ERRO and the readable message, and whether the user may continue', () => {
  const s = boot.snapshot(['data'], { message: 'Disco cheio', canContinue: true });
  assert.equal(s.label, 'ERRO');
  assert.deepEqual(s.error, { message: 'Disco cheio', canContinue: true });
  assert.equal(s.percent, 15, 'progress is not faked on failure');
  assert.equal(boot.snapshot(['data'], new Error('x')).error.canContinue, false);
});

test('createBoot reports every real change once, in order, and ignores repeats and unknown stages', () => {
  const seen = [];
  const b = boot.createBoot({ onChange: (s) => seen.push(s.percent + ':' + s.label) });
  b.complete('data');
  b.complete('data');
  b.complete('nope');
  b.complete('ui');
  assert.equal(b.allDone(), false);
  b.complete('ias');
  b.complete('memory');
  assert.equal(b.allDone(), true);
  assert.deepEqual(seen, ['15:INICIANDO MEMÓRIA', '45:INICIANDO MEMÓRIA', '70:INICIANDO MEMÓRIA', '100:PRONTO']);
  const percents = seen.map((x) => parseInt(x, 10));
  assert.deepEqual(
    percents,
    [...percents].sort((a, c) => a - c),
    'never goes backwards'
  );
});

test('createBoot: a failure is final (later stages cannot hide it) and is reported once', () => {
  const seen = [];
  const b = boot.createBoot({ onChange: (s) => seen.push(s) });
  b.complete('data');
  b.fail('Não foi possível ler os dados', { canContinue: false });
  b.fail('outra falha');
  b.complete('memory');
  assert.equal(b.failed(), true);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].error.message, 'Não foi possível ler os dados');
  assert.equal(b.isDone('memory'), false);
});

test('the splash never leaves before 1.2 s, and the window opens only when everything is ready', () => {
  assert.equal(boot.MIN_SPLASH_MS, 1200);
  assert.equal(boot.splashRemaining(1000, 1300), 900);
  assert.equal(boot.splashRemaining(1000, 2300), 0);
  assert.equal(boot.splashRemaining(0, 5000), 1200, 'not shown yet: the full time still applies');
  const base = { complete: true, mainReady: true, shownAt: 1000 };
  assert.equal(boot.mayReveal({ ...base, now: 1500 }), false, 'too early');
  assert.equal(boot.mayReveal({ ...base, now: 2300 }), true);
  assert.equal(boot.mayReveal({ ...base, now: 9999, complete: false }), false, 'boot not finished');
  assert.equal(boot.mayReveal({ ...base, now: 9999, mainReady: false }), false, 'window not painted yet');
});
