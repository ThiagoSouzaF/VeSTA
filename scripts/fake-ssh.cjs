// A fake `ssh` for the VPS E2E (scripts/test-places-vps-e2e.cjs): takes ssh's arguments, ignores the options and runs
// the command (`sh -lc '…'`) in Git Bash with HOME set to a throwaway folder, the "VPS". A small prelude makes paths
// come out the way Node on this machine reads them (C:/…), stands in for `sh -lc` with a plain bash and says it is
// Linux. While the file <home>/../vps-down exists it answers like ssh with no network (exit 255).
// Usage (VESTA_SSH): { "exe": node, "args": ["scripts/fake-ssh.cjs", "<vps home>", "<bin folder>"] }
const fs = require('node:fs'),
  path = require('node:path');
const { spawn } = require('node:child_process');

const [home, bin, ...sshArgs] = process.argv.slice(2);
if (fs.existsSync(path.join(home, '..', 'vps-down'))) {
  process.stderr.write('ssh: connect to host 203.0.113.10 port 22: Connection timed out\r\n');
  process.exit(255);
}
const command = sshArgs[sshArgs.length - 1];
const bash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].find((f) =>
  fs.existsSync(f)
);
// The AIs are looked up only in the fake's own bin folder: the real ones of this PC must never be found.
const prelude = [
  'export HOME="$(cygpath -m "$HOME")" FAKE_BIN="$(cygpath -m "$FAKE_BIN")"',
  'command() { if [ "$1" = "-v" ]; then case "$2" in claude|codex|opencode|drael) [ -e "$FAKE_BIN/$2" ] && echo "$FAKE_BIN/$2";; *) local p; p=$(builtin command -v "$2") || return 1; case "$p" in /*) cygpath -m "$p";; *) echo "$p";; esac;; esac; else builtin command "$@"; fi; }',
  'uname() { case "$1" in -m) echo x86_64;; *) echo Linux;; esac; }',
  'export -f command uname',
  'sh() { if [ "$1" = "-lc" ]; then bash -c "$2"; else builtin command sh "$@"; fi; }',
].join('\n');
const env = { ...process.env, HOME: home, FAKE_BIN: bin };
const child = spawn(bash, ['-c', prelude + '\n' + command], { env, stdio: ['pipe', 'inherit', 'inherit'] });
process.stdin.pipe(child.stdin);
child.on('close', (code) => process.exit(code ?? 1));
