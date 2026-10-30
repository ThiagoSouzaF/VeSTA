// The MCP servers VeSTA hands to each CLI (descriptors) and how every CLI receives them (flags/env).
// MCP servers are registered per launch (flags/env), never in ~/.claude, ~/.codex or the global OpenCode config.
// Servers: the AI Memory (vesta-memory), the quest's own chat tools (vesta-quest) and the app's preferences (vesta-app).
const MEMORY_SERVER = 'vesta-memory',
  MEMORY_TOKEN_ENV = 'VESTA_MEMORY_TOKEN',
  QUEST_SERVER = 'vesta-quest',
  QUEST_TOKEN_ENV = 'VESTA_QUEST_TOKEN',
  APP_SERVER = 'vesta-app',
  APP_TOKEN_ENV = 'VESTA_APP_TOKEN';
// A server entry: { name, url, token, tokenEnv }. The helpers turn the endpoints the main process holds into entries.
const memoryServer = (endpoint) =>
  endpoint && { name: MEMORY_SERVER, url: endpoint.mcp, token: endpoint.token, tokenEnv: MEMORY_TOKEN_ENV };
const questServer = (endpoint) =>
  endpoint && { name: QUEST_SERVER, url: endpoint.mcp, token: endpoint.token, tokenEnv: QUEST_TOKEN_ENV };
const appServer = (endpoint) =>
  endpoint && { name: APP_SERVER, url: endpoint.mcp, token: endpoint.token, tokenEnv: APP_TOKEN_ENV };
// One or more servers for a provider -> { args, env }. The tokens travel by environment; each CLI expands them into the
// Authorization header itself, so they never appear on a command line.
function mcpTools(provider, servers) {
  servers = (servers || []).filter(Boolean);
  if (!servers.length) return { args: [], env: {} };
  const env = Object.fromEntries(servers.map((x) => [x.tokenEnv, x.token]));
  if (provider === 'claude')
    return {
      env,
      args: [
        '--mcp-config',
        JSON.stringify({
          mcpServers: Object.fromEntries(
            servers.map((x) => [
              x.name,
              { type: 'http', url: x.url, headers: { Authorization: 'Bearer ${' + x.tokenEnv + '}' } },
            ])
          ),
        }),
        '--allowedTools',
        ...servers.map((x) => 'mcp__' + x.name),
      ],
    };
  if (provider === 'codex')
    return {
      env,
      args: servers.flatMap((x) => {
        const key = 'mcp_servers.' + x.name + '.';
        return [
          '-c',
          key + 'url="' + x.url + '"',
          '-c',
          key + 'bearer_token_env_var="' + x.tokenEnv + '"',
          '-c',
          key + 'default_tools_approval_mode="approve"',
        ];
      }),
    };
  return {
    args: [],
    env: {
      ...env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        mcp: Object.fromEntries(
          servers.map((x) => [
            x.name,
            {
              type: 'remote',
              url: x.url,
              enabled: true,
              oauth: false,
              headers: { Authorization: 'Bearer {env:' + x.tokenEnv + '}' },
            },
          ])
        ),
      }),
    },
  };
}
// The AI Memory alone (kept for callers and tests that only know the memory endpoint).
const memoryTools = (provider, endpoint) => mcpTools(provider, [memoryServer(endpoint)]);
module.exports = {
  MEMORY_SERVER,
  MEMORY_TOKEN_ENV,
  QUEST_SERVER,
  QUEST_TOKEN_ENV,
  APP_SERVER,
  APP_TOKEN_ENV,
  memoryServer,
  questServer,
  appServer,
  mcpTools,
  memoryTools,
};
