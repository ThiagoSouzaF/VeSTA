const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { terminalCommand } = require('../electron/terminal.cjs');
const decode = (cmd) => Buffer.from(cmd.args[2], 'base64').toString('utf16le');

test('terminal command targets PowerShell with an encoded script', () => {
  const cmd = terminalCommand({ id: 'codex', exe: 'C:\bincodex.exe', chat: null, cwd: 'C:work' });
  assert.equal(cmd.exe, 'powershell.exe');
  assert.deepEqual(cmd.args.slice(0, 2), ['-NoExit', '-EncodedCommand']);
  assert.equal(cmd.cwd, 'C:work');
  assert.equal(decode(cmd), "Set-Location -LiteralPath 'C:work'; & 'C:\bincodex.exe' ");
});

test('resumes the native session with each provider flag style', () => {
  const run = (id, extra) =>
    decode(terminalCommand({ id, exe: 'x.exe', chat: { sessionId: 's1', ...extra }, cwd: 'C:w' }));
  assert.match(run('codex'), /& 'x\.exe' 'resume' 's1'$/);
  assert.match(run('claude'), /& 'x\.exe' '--resume' 's1'$/);
  assert.match(run('opencode'), /& 'x\.exe' '--session' 's1'$/);
});

test('appends the chat model and escapes single quotes', () => {
  const script = decode(terminalCommand({ id: 'claude', exe: "C:o'kc.exe", chat: { model: 'opus' }, cwd: "C:it's" }));
  assert.equal(script, "Set-Location -LiteralPath 'C:it''s'; & 'C:o''kc.exe' '--model' 'opus'");
});
