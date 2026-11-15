// The CLI drivers never leave a chat "answering" forever: a Codex that does not answer, a Codex that dies, and an
// OpenCode whose event stream ends before the answer all end the turn with an error.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const drivers = require('../electron/ai/drivers.cjs');
const providers = require('../electron/ai/providers.cjs');

const fixture = (name) => path.join(__dirname, 'fixtures', name);
function context(provider, extra = {}) {
  const events = [];
  return {
    events,
    ctx: {
      cwd: __dirname,
      env: { ...extra.env, PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      prompt: 'olá',
      attachments: [],
      parse: providers.parser(provider, (e) => events.push(e)),
      ask: async () => ({ allow: false }),
      ...extra.ctx,
    },
  };
}
const errorOf = (events) =>
  events
    .filter((e) => e.type === 'provider-error')
    .map((e) => e.message)
    .join(' | ');
const within = (p, ms) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('o turno não terminou')), ms))]);

test('Codex that never answers the handshake: the turn ends with an error instead of hanging', async () => {
  const { ctx, events } = context('codex', { env: { FAKE_CODEX: 'silent' }, ctx: { requestTimeoutMs: 300 } });
  const run = drivers.start('codex', { exe: process.execPath, args: [fixture('fake-codex.cjs')] }, ctx);
  await within(run.done, 8000);
  // send() fails the turn on this provider error (whatever the exit code of the closed process).
  assert.match(errorOf(events), /não respondeu a initialize/);
});

test('Codex that dies at start: what was waiting is rejected and the turn ends', async () => {
  const { ctx } = context('codex', { env: { FAKE_CODEX: 'exit' } });
  const run = drivers.start('codex', { exe: process.execPath, args: [fixture('fake-codex.cjs')] }, ctx);
  const res = await within(run.done, 8000);
  assert.equal(res.code, 3);
});

test('OpenCode whose event stream closes before session.idle: error, and the server is closed', async () => {
  const { ctx, events } = context('opencode');
  const run = drivers.start('opencode', { exe: process.execPath, args: [fixture('fake-opencode.cjs')] }, ctx);
  const res = await within(run.done, 15000);
  assert.notEqual(res.code, 0);
  assert.match(errorOf(events), /encerrou a conexão antes de terminar/);
});
