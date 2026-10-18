const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { createBus } = require('../electron/events.cjs');

test('bus delivers each event to every subscriber in order', () => {
  const bus = createBus(),
    a = [],
    b = [];
  bus.subscribe((e) => a.push(e));
  bus.subscribe((e) => b.push(e));
  bus.emit({ type: 'x' });
  bus.emit({ type: 'y' });
  assert.deepEqual(a, [{ type: 'x' }, { type: 'y' }]);
  assert.deepEqual(b, a);
});

test('unsubscribe stops delivery to that subscriber only', () => {
  const bus = createBus(),
    a = [],
    b = [];
  const off = bus.subscribe((e) => a.push(e));
  bus.subscribe((e) => b.push(e));
  off();
  bus.emit({ type: 'x' });
  assert.equal(a.length, 0);
  assert.equal(b.length, 1);
});

test('a throwing subscriber does not block the others or the emitter', () => {
  const bus = createBus(),
    seen = [];
  bus.subscribe(() => {
    throw new Error('boom');
  });
  bus.subscribe((e) => seen.push(e));
  assert.doesNotThrow(() => bus.emit({ type: 'x' }));
  assert.equal(seen.length, 1);
});

test('emitting with no subscribers is a no-op', () => {
  assert.doesNotThrow(() => createBus().emit({ type: 'x' }));
});
