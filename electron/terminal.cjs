const os = require('node:os');
const { spawn } = require('node:child_process');
const quote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// Pure: decides what to launch for a chat/provider, so it can be tested without spawning anything.
function terminalCommand({ id, exe, chat, cwd }) {
  let args = chat?.sessionId
    ? id === 'codex'
      ? ['resume', chat.sessionId]
      : id === 'claude'
        ? ['--resume', chat.sessionId]
        : ['--session', chat.sessionId]
    : [];
  if (id === 'drael') args = [require('./drael.cjs').script(exe)];
  else if (chat?.model) args.push('--model', chat.model);
  const script = 'Set-Location -LiteralPath ' + quote(cwd) + '; & ' + quote(exe) + ' ' + args.map(quote).join(' ');
  return {
    exe: 'powershell.exe',
    args: ['-NoExit', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    cwd,
  };
}
function openTerminal(ctx, { chatId, provider }) {
  const chat = chatId ? ctx.store.chat(chatId) : null;
  const id = chat?.provider || provider;
  const exe = ctx.integrations[id]?.exe;
  if (!exe) throw new Error('Programa não encontrado');
  const cwd = chat ? ctx.workdir(chat) : os.homedir();
  const cmd = terminalCommand({ id, exe, chat, cwd });
  spawn(cmd.exe, cmd.args, {
    cwd: cmd.cwd,
    env: id === 'drael' ? { ...process.env, ...require('./drael.cjs').authEnv() } : process.env,
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  }).unref();
  return true;
}
module.exports = { terminalCommand, openTerminal };
