const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { terminalCommand, spawnTerminal } = require('../electron/terminal.cjs');
const decode = (cmd) => Buffer.from(cmd.args.at(-1), 'base64').toString('utf16le');

test('terminal command targets PowerShell with an encoded script', () => {
  const cmd = terminalCommand({ id: 'codex', exe: 'C:/bin/codex.exe', chat: null, cwd: 'C:/work' });
  assert.equal(cmd.exe, 'powershell.exe');
  assert.deepEqual(cmd.args.slice(0, 2), ['-NoExit', '-EncodedCommand']);
  assert.equal(cmd.cwd, 'C:/work');
  assert.ok(decode(cmd).startsWith("Set-Location -LiteralPath 'C:/work'; & 'C:/bin/codex.exe' "));
});

test('noExit false drops -NoExit so the shell closes with the CLI', () => {
  const cmd = terminalCommand({ id: 'claude', exe: 'x.exe', chat: null, cwd: 'C:/w', noExit: false });
  assert.deepEqual(cmd.args.slice(0, 1), ['-EncodedCommand']);
  assert.equal(cmd.args.length, 2);
});

test('resumes the native session with each provider flag style', () => {
  const run = (id, extra) =>
    decode(terminalCommand({ id, exe: 'x.exe', chat: { sessionId: 's1', mode: 'ask', ...extra }, cwd: 'C:/w' }));
  assert.match(run('codex'), /& 'x\.exe' 'resume' 's1' /);
  assert.match(run('claude'), /& 'x\.exe' '--resume' 's1'$/);
  assert.match(run('opencode'), /& 'x\.exe' '--session' 's1'$/);
});

test('appends the chat model and escapes single quotes', () => {
  const script = decode(
    terminalCommand({ id: 'claude', exe: "C:/o'k/c.exe", chat: { model: 'opus', mode: 'ask' }, cwd: "C:/it's" })
  );
  assert.equal(script, "Set-Location -LiteralPath 'C:/it''s'; & 'C:/o''k/c.exe' '--model' 'opus'");
});

test('the chat mode becomes each CLI full-access / consultation flags', () => {
  const run = (id, mode) => decode(terminalCommand({ id, exe: 'x.exe', chat: { mode }, cwd: 'C:/w' }));
  const tail = (s) => s.replace(/^.*& 'x\.exe' ?/, '');
  assert.equal(tail(run('codex', 'edit')), "'--sandbox' 'danger-full-access' '--ask-for-approval' 'never'");
  assert.equal(tail(run('codex', 'read')), "'--sandbox' 'read-only' '--ask-for-approval' 'never'");
  assert.equal(tail(run('codex', 'ask')), "'--sandbox' 'read-only' '--ask-for-approval' 'on-request'");
  assert.equal(tail(run('claude', 'edit')), "'--permission-mode' 'bypassPermissions'");
  assert.equal(tail(run('claude', 'read')), "'--permission-mode' 'plan'");
  assert.equal(tail(run('claude', 'ask')), '');
  assert.equal(tail(run('opencode', 'read')), "'--agent' 'plan'");
  assert.match(run('drael', 'edit'), /'--mode' 'bypass'$/);
  assert.match(run('drael', 'read'), /'--mode' 'plan'$/);
  // A chat without mode behaves as the default (full access), like providers.command().
  assert.match(decode(terminalCommand({ id: 'claude', exe: 'x.exe', chat: {}, cwd: 'C:/w' })), /bypassPermissions/);
});

test('opencode permissions travel in the environment', () => {
  const env = (mode) => terminalCommand({ id: 'opencode', exe: 'x.exe', chat: { mode }, cwd: 'C:/w' }).env;
  assert.equal(JSON.parse(env('edit').OPENCODE_PERMISSION).bash, 'allow');
  assert.equal(JSON.parse(env('read').OPENCODE_PERMISSION).bash, 'deny');
  assert.equal(JSON.parse(env('ask').OPENCODE_PERMISSION).edit, 'ask');
  assert.deepEqual(terminalCommand({ id: 'claude', exe: 'x', chat: null, cwd: 'C:/w' }).env, {});
});

// Real spawn: a fake CLI that writes a marker file with its arguments and exits. Proves the command built for
// the terminal actually runs in a freshly created console (the old detached spawn never ran the script).
test(
  'the spawned terminal really runs the command and exits',
  { skip: process.platform !== 'win32', timeout: 60000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-term-'));
    try {
      const marker = path.join(dir, 'marker.txt'),
        exe = path.join(dir, 'fakecli.cmd');
      fs.writeFileSync(exe, '@echo off\r\necho %CD%^|%*^|%OPENCODE_PERMISSION%> "' + marker + '"\r\n');
      const cmd = terminalCommand({
        id: 'opencode',
        exe,
        chat: { sessionId: 's9', mode: 'read' },
        cwd: dir,
        noExit: false,
      });
      const child = spawnTerminal(cmd);
      const code = await new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          child.kill();
          reject(new Error('o terminal não terminou'));
        }, 45000);
        child.on('exit', (c) => {
          clearTimeout(t);
          resolve(c);
        });
      });
      assert.equal(code, 0);
      assert.ok(fs.existsSync(marker), 'o script não executou (arquivo-marca ausente)');
      const [cwd, args, perm] = fs.readFileSync(marker, 'utf8').trim().split('|');
      assert.equal(path.resolve(cwd).toLowerCase(), path.resolve(dir).toLowerCase());
      assert.equal(args, '--session s9 --agent plan');
      assert.equal(JSON.parse(perm).bash, 'deny');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
