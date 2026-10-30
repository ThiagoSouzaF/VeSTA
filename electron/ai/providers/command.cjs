// How each CLI is launched for a chat: executable, arguments, environment and permission policy per mode.
const fs = require('node:fs');
const { CODEX_PRIVATE_ARGS } = require('../../app/privacy.cjs');
const drael = require('../drael.cjs');
const { QUEST_SERVER, memoryServer, mcpTools } = require('./mcp-servers.cjs');

// What the quest's own chat may never do in Claude (it acts on the quest through vesta-quest only).
const LEAD_DENIED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor'];
// Chat modes: 'edit' = full access, 'ask' = the agent asks the user before acting, 'read' = consultation only.
const MODES = ['ask', 'edit', 'read'];
const modeOf = (chat) => (MODES.includes(chat.mode) ? chat.mode : 'edit');
// How each CLI is launched. Claude speaks stream-json both ways (its permission requests arrive on stdout and are
// answered on stdin); Codex runs its app-server (JSON-RPC with approval requests); OpenCode runs its HTTP server.
// `endpoint` = AI Memory; `extra` = more MCP servers (entries, see questServer), e.g. the quest chat's own.
function command(chat, exe, endpoint, { attachDir = null, extra = [] } = {}) {
  const servers = [memoryServer(endpoint), ...extra].filter(Boolean);
  if (chat.provider === 'drael') return drael.command(chat, exe, servers);
  const mode = modeOf(chat),
    mem = mcpTools(chat.provider, servers);
  if (chat.provider === 'codex') {
    const policy =
      mode === 'ask'
        ? { approvalPolicy: 'on-request', sandbox: 'read-only' }
        : { approvalPolicy: 'never', sandbox: mode === 'edit' ? 'danger-full-access' : 'read-only' };
    return {
      exe,
      args: ['app-server', ...CODEX_PRIVATE_ARGS, ...mem.args],
      env: mem.env,
      thread: { ...policy, ...(chat.model ? { model: chat.model } : {}) },
      resume: chat.sessionId || null,
    };
  }
  if (chat.provider === 'claude') {
    // Even with full access, Claude still asks before touching protected files (settings, .git): those go to the user too.
    // The quest chat is read-only too, but it must act on the quest through its MCP tools. Claude's plan mode makes the
    // model itself refuse any action ("plan mode is active"), so there it runs in the default mode with every tool that
    // edits or executes denied and no prompt channel: anything not allowed (the MCP tools) is refused outright.
    const lead = mode === 'read' && servers.some((x) => x.name === QUEST_SERVER);
    const permission = lead
      ? ['--permission-mode', 'default', '--disallowedTools', ...LEAD_DENIED_TOOLS]
      : mode === 'read'
        ? ['--permission-mode', 'plan', '--permission-prompts', 'none']
        : ['--permission-mode', mode === 'edit' ? 'bypassPermissions' : 'default', '--permission-prompt-tool', 'stdio'];
    return {
      exe,
      args: [
        '--print',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        ...permission,
        ...mem.args,
        // The chat's attachments live outside the project folder: let Claude read them without asking.
        ...(attachDir && fs.existsSync(attachDir) ? ['--add-dir', attachDir] : []),
        ...(chat.model ? ['--model', chat.model] : []),
        ...(chat.sessionId ? ['--resume', chat.sessionId] : []),
      ],
      env: mem.env,
    };
  }
  const permission =
    mode === 'read'
      ? { edit: 'deny', bash: 'deny', webfetch: 'allow', question: 'deny' }
      : mode === 'ask'
        ? { edit: 'ask', bash: 'ask', webfetch: 'ask', external_directory: 'ask', question: 'deny' }
        : { edit: 'allow', bash: 'allow', webfetch: 'allow', question: 'deny' };
  // The chat's attachments live outside the project: the agent may read exactly that folder without asking.
  if (attachDir && fs.existsSync(attachDir))
    permission.external_directory = { '*': 'ask', [attachDir.replaceAll('\\', '/') + '/*']: 'allow' };
  const slash = chat.model ? chat.model.indexOf('/') : -1;
  return {
    exe,
    args: ['serve', '--hostname', '127.0.0.1'],
    env: { ...mem.env, OPENCODE_PERMISSION: JSON.stringify(permission) },
    model: slash > 0 ? { providerID: chat.model.slice(0, slash), modelID: chat.model.slice(slash + 1) } : null,
    agent: mode === 'read' ? 'plan' : chat.agent || 'build',
    resume: chat.sessionId || null,
  };
}
module.exports = { MODES, modeOf, LEAD_DENIED_TOOLS, command };
