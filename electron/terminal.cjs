const os = require('node:os');
const { spawn } = require('node:child_process');
const quote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// Access flags of each CLI's interactive mode, matching what providers.command() uses for the chat:
// edit = full access, read = consultation (plan / read-only), ask = the CLI's own default prompts.
function modeFlags(id, mode) {
  if (id === 'codex')
    return mode === 'edit'
      ? ['--sandbox', 'danger-full-access', '--ask-for-approval', 'never']
      : mode === 'read'
        ? ['--sandbox', 'read-only', '--ask-for-approval', 'never']
        : ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'];
  if (id === 'claude')
    return mode === 'edit'
      ? ['--permission-mode', 'bypassPermissions']
      : mode === 'read'
        ? ['--permission-mode', 'plan']
        : [];
  if (id === 'drael') return mode === 'edit' ? ['--mode', 'bypass'] : mode === 'read' ? ['--mode', 'plan'] : [];
  return mode === 'read' ? ['--agent', 'plan'] : [];
}
// OpenCode takes its permissions from the environment, like in the chat.
function modeEnv(id, mode) {
  if (id !== 'opencode') return {};
  const permission =
    mode === 'read'
      ? { edit: 'deny', bash: 'deny', webfetch: 'allow', question: 'deny' }
      : mode === 'ask'
        ? { edit: 'ask', bash: 'ask', webfetch: 'ask', external_directory: 'ask', question: 'deny' }
        : { edit: 'allow', bash: 'allow', webfetch: 'allow', question: 'deny' };
  return { OPENCODE_PERMISSION: JSON.stringify(permission) };
}
// Pure: decides what to launch for a chat/provider, so it can be tested without spawning anything.
// `noExit: false` makes the shell close when the CLI ends (used only by the real-spawn test).
function terminalCommand({ id, exe, chat, cwd, noExit = true }) {
  const mode = require('./providers.cjs').MODES.includes(chat?.mode) ? chat.mode : 'edit';
  let args = chat?.sessionId
    ? id === 'codex'
      ? ['resume', chat.sessionId]
      : id === 'claude'
        ? ['--resume', chat.sessionId]
        : id === 'drael'
          ? []
          : ['--session', chat.sessionId]
    : [];
  if (id === 'drael') args = [require('./drael.cjs').script(exe)];
  else if (chat?.model) args.push('--model', chat.model);
  args.push(...modeFlags(id, mode));
  const script = 'Set-Location -LiteralPath ' + quote(cwd) + '; & ' + quote(exe) + ' ' + args.map(quote).join(' ');
  return {
    exe: 'powershell.exe',
    args: [...(noExit ? ['-NoExit'] : []), '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    cwd,
    env: modeEnv(id, mode),
  };
}
// Not detached: with `detached` Node creates the process without a console (DETACHED_PROCESS) and on Windows
// PowerShell then exits at once, never running the script. Without it the child gets its own console window.
function spawnTerminal(cmd, baseEnv = process.env) {
  const child = spawn(cmd.exe, cmd.args, {
    cwd: cmd.cwd,
    env: { ...baseEnv, ...cmd.env },
    windowsHide: false,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  child.unref();
  return child;
}
function openTerminal(ctx, { chatId, provider }) {
  const chat = chatId ? ctx.store.chat(chatId) : null;
  const id = chat?.provider || provider;
  const exe = ctx.integrations[id]?.exe;
  if (!exe) throw new Error('Programa não encontrado');
  const cwd = chat ? ctx.workdir(chat) : os.homedir();
  const cmd = terminalCommand({ id, exe, chat, cwd });
  spawnTerminal(cmd, id === 'drael' ? { ...process.env, ...require('./drael.cjs').authEnv() } : process.env);
  return true;
}
module.exports = { terminalCommand, spawnTerminal, openTerminal, modeFlags };
