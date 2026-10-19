const { test } = require('node:test'),
  assert = require('node:assert/strict');
const Module = require('node:module');

// background-mode.cjs only reads `app` from electron; a stub is enough to test the decision.
const original = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { isPackaged: false, commandLine: { appendSwitch() {} } } };
  return original.call(this, request, ...rest);
};
const { backgroundMode } = require('../electron/background-mode.cjs');
Module._load = original;

test('test runs with a throwaway data dir open their windows in the background', () => {
  assert.equal(backgroundMode({ VESTA_DATA_DIR: 'C:/tmp/vesta-x' }, false), true);
  assert.equal(backgroundMode({}, false), false);
});

test('VESTA_TEST_BACKGROUND forces it on or off', () => {
  assert.equal(backgroundMode({ VESTA_TEST_BACKGROUND: '1' }, false), true);
  assert.equal(backgroundMode({ VESTA_DATA_DIR: 'C:/tmp/vesta-x', VESTA_TEST_BACKGROUND: '0' }, false), false);
});

test('the packaged app never hides its windows', () => {
  assert.equal(backgroundMode({ VESTA_DATA_DIR: 'x', VESTA_TEST_BACKGROUND: '1' }, true), false);
});
