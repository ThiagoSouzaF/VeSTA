// Tuning of the code-rain backdrop (src/lib/backdropRain.js): scene choice, speed, frame budget. Pure.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const lib = () => import('../src/lib/backdropRain.js');

test('Tinta Mangá turns "Chuva de código" into the ink rain; other themes keep the classic one', async () => {
  const { resolveScene } = await lib();
  assert.equal(resolveScene('rain', 'ink'), 'inkrain');
  assert.equal(resolveScene('rain', 'obsidian'), 'rain');
  assert.equal(resolveScene('inkrain', 'paper'), 'inkrain', 'also available as a variation in any theme');
  assert.equal(resolveScene('inkrain', 'ink'), 'inkrain');
  assert.equal(resolveScene('ember', 'ink'), 'ember');
  assert.equal(resolveScene('stream', 'ink'), 'stream');
  assert.equal(resolveScene('none', 'ink'), 'none');
});

test('the ink rain falls at 40-60% of the classic speed and draws at film cadence (24-30 fps)', async () => {
  const { RAIN, rainProfile } = await lib();
  const mean = (p) => (p.speed[0] + p.speed[1]) / 2;
  const ratio = mean(RAIN.ink) / mean(RAIN.classic);
  assert.ok(ratio >= 0.4 && ratio <= 0.6, 'ratio ' + ratio);
  assert.ok(RAIN.ink.speed[1] / RAIN.classic.speed[1] <= 0.6 && RAIN.ink.speed[0] / RAIN.classic.speed[0] >= 0.4);
  assert.ok(RAIN.ink.fps >= 24 && RAIN.ink.fps <= 30);
  assert.equal(rainProfile('inkrain'), RAIN.ink);
  assert.equal(rainProfile('rain'), RAIN.classic);
});

test('drop speed stays inside the profile range for any random draw', async () => {
  const { RAIN, dropSpeed } = await lib();
  assert.equal(
    dropSpeed(RAIN.ink, () => 0),
    RAIN.ink.speed[0]
  );
  assert.equal(
    dropSpeed(RAIN.ink, () => 1),
    RAIN.ink.speed[1]
  );
  for (const r of [0.1, 0.5, 0.99]) {
    const v = dropSpeed(RAIN.ink, () => r);
    assert.ok(v >= RAIN.ink.speed[0] && v <= RAIN.ink.speed[1]);
  }
});

test('motion is time based: the same distance at any frame rate, and a late frame never makes a jump', async () => {
  const { advance, MAX_FRAME_MS } = await lib();
  let a = 0;
  for (let i = 0; i < 24; i++) a = advance(a, 5, 1000 / 24);
  let b = 0;
  for (let i = 0; i < 60; i++) b = advance(b, 5, 1000 / 60);
  assert.ok(Math.abs(a - 5) < 1e-9 && Math.abs(b - 5) < 1e-9, 'one second of 5 rows/s moves 5 rows: ' + a + ' ' + b);
  assert.equal(advance(0, 10, 60_000), (10 * MAX_FRAME_MS) / 1000, 'a minute-long stall moves one frame budget');
  assert.equal(advance(3, 10, -5), 3, 'a clock going backwards does not move the drop');
});

test('frame limiter: 24 fps on a 60 Hz screen averages 24 (carries the late part)', async () => {
  const { frameDue, nextLast, frameInterval } = await lib();
  assert.ok(Math.abs(frameInterval(24) - 41.667) < 0.01);
  let last = 0,
    drawn = 0;
  for (let t = 0; t <= 10_000; t += 1000 / 60) {
    if (frameDue(t, last, 24)) {
      last = nextLast(t, last, 24);
      drawn++;
    }
  }
  const fps = drawn / 10;
  assert.ok(fps >= 23 && fps <= 25, 'drew ' + fps + ' fps');
  assert.equal(frameDue(10, 0, 24), false);
  assert.equal(frameDue(42, 0, 24), true);
});

test('ink trail: the head is the strongest tone, the trail steps down, past the end nothing is drawn', async () => {
  const { trailLevel, RAIN } = await lib();
  const n = RAIN.ink.trail;
  assert.equal(trailLevel(0, n), 0);
  const levels = Array.from({ length: n }, (_, k) => trailLevel(k, n));
  assert.deepEqual(
    levels,
    [...levels].sort((a, b) => a - b),
    'non-decreasing along the trail'
  );
  assert.equal(Math.max(...levels), 3);
  assert.equal(new Set(levels).size, 4, 'four printed tones');
  assert.equal(trailLevel(n, n), -1);
  assert.equal(trailLevel(-1, n), -1);
});
