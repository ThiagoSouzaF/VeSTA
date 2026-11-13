// Public face of the provider layer (Claude, Codex, OpenCode, Drael): the implementation lives in providers/.
const { run, kill } = require('../util/proc.cjs');
const { locate } = require('./providers/locate.cjs');
const mcp = require('./providers/mcp-servers.cjs');
const { memoryHint, PROFILE_CATEGORIES } = require('./providers/hints.cjs');
const { MODES, modeOf, EFFORTS, effortOf, command } = require('./providers/command.cjs');
const { parser } = require('./providers/parser.cjs');
const { rateWindows, normWindow } = require('./providers/rate-windows.cjs');
const { upsertSubagent, upsertActivity, applyToMessage } = require('./providers/message-merge.cjs');

module.exports = {
  applyToMessage,
  MODES,
  modeOf,
  EFFORTS,
  effortOf,
  locate,
  run,
  kill,
  command,
  memoryTools: mcp.memoryTools,
  mcpTools: mcp.mcpTools,
  memoryServer: mcp.memoryServer,
  questServer: mcp.questServer,
  appServer: mcp.appServer,
  memoryHint,
  PROFILE_CATEGORIES,
  MEMORY_SERVER: mcp.MEMORY_SERVER,
  QUEST_SERVER: mcp.QUEST_SERVER,
  QUEST_TOKEN_ENV: mcp.QUEST_TOKEN_ENV,
  APP_SERVER: mcp.APP_SERVER,
  APP_TOKEN_ENV: mcp.APP_TOKEN_ENV,
  parser,
  upsertSubagent,
  upsertActivity,
  rateWindows,
  normWindow,
};
