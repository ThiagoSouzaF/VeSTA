// Public face of the provider layer (Claude, Codex, OpenCode, Drael): the implementation lives in providers/.
const { run } = require('../util/proc.cjs');
const { locate } = require('./providers/locate.cjs');
const mcp = require('./providers/mcp-servers.cjs');
const { memoryHint } = require('./providers/hints.cjs');
const { MODES, modeOf, EFFORTS, effortOf, command } = require('./providers/command.cjs');
const { parser } = require('./providers/parser.cjs');
const { rateWindows } = require('./providers/rate-windows.cjs');
const { upsertSubagent, upsertActivity, applyToMessage } = require('./providers/message-merge.cjs');

module.exports = {
  applyToMessage,
  MODES,
  modeOf,
  EFFORTS,
  effortOf,
  locate,
  run,
  command,
  memoryTools: mcp.memoryTools,
  mcpTools: mcp.mcpTools,
  memoryServer: mcp.memoryServer,
  questServer: mcp.questServer,
  appServer: mcp.appServer,
  skillsServer: mcp.skillsServer,
  memoryHint,
  MEMORY_SERVER: mcp.MEMORY_SERVER,
  QUEST_SERVER: mcp.QUEST_SERVER,
  parser,
  upsertSubagent,
  upsertActivity,
  rateWindows,
};
