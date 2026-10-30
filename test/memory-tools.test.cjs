const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const {
  command,
  parser,
  memoryTools,
  mcpTools,
  memoryServer,
  questServer,
  memoryHint,
  MEMORY_SERVER,
  QUEST_SERVER,
} = require('../electron/providers.cjs');
const drael = require('../electron/drael.cjs');
const { Memory } = require('../electron/memory.cjs');
const endpoint = { url: 'http://127.0.0.1:50001', mcp: 'http://127.0.0.1:50001/mcp', token: 'secret-token-value' };
test('without an endpoint no provider gets memory tools', () => {
  for (const provider of ['claude', 'codex', 'opencode']) {
    const c = command({ provider, mode: 'edit' }, 'x.exe');
    assert.ok(!c.args.join(' ').includes(MEMORY_SERVER));
    assert.ok(!Object.keys(c.env).some((k) => k.startsWith('VESTA_') || k === 'OPENCODE_CONFIG_CONTENT'));
  }
});
test('memory tools are registered per launch and the token never goes on the command line', () => {
  const claude = command({ provider: 'claude', mode: 'edit' }, 'claude.exe', endpoint);
  const config = JSON.parse(claude.args[claude.args.indexOf('--mcp-config') + 1]);
  assert.equal(config.mcpServers[MEMORY_SERVER].url, endpoint.mcp);
  assert.equal(config.mcpServers[MEMORY_SERVER].type, 'http');
  assert.ok(claude.args.includes('mcp__' + MEMORY_SERVER));
  const codex = command({ provider: 'codex', mode: 'edit', sessionId: 's1' }, 'codex.exe', endpoint);
  assert.ok(codex.args.includes('mcp_servers.' + MEMORY_SERVER + '.url="' + endpoint.mcp + '"'));
  assert.equal(codex.args[0], 'app-server');
  assert.equal(codex.resume, 's1');
  const opencode = command({ provider: 'opencode', mode: 'edit' }, 'opencode.exe', endpoint);
  assert.equal(JSON.parse(opencode.env.OPENCODE_CONFIG_CONTENT).mcp[MEMORY_SERVER].url, endpoint.mcp);
  for (const c of [claude, codex, opencode]) {
    assert.ok(!c.args.join(' ').includes(endpoint.token));
    assert.equal(c.env.VESTA_MEMORY_TOKEN, endpoint.token);
  }
  assert.ok(!opencode.env.OPENCODE_CONFIG_CONTENT.includes(endpoint.token));
});
test('memory hint names the chat scope', () => {
  assert.match(memoryHint('p-1'), /project "p-1"/);
  assert.match(memoryHint(null), /project "inbox"/);
  assert.match(memoryHint(null), /workspace "vesta"/);
});
test('memory tool calls show as memory activities in every provider', () => {
  const ev = [];
  parser('claude', (e) => ev.push(e)).accept({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 't1', name: 'mcp__' + MEMORY_SERVER + '__memory_query', input: { query: 'auth' } },
      ],
    },
  });
  assert.equal(ev[0].kind, 'memory');
  assert.equal(ev[0].label, 'Memória · memory_query');
  assert.equal(ev[0].detail, 'auth');
  const cx = [];
  parser('codex', (e) => cx.push(e)).accept({
    method: 'item/completed',
    params: {
      item: {
        id: 'i1',
        type: 'mcpToolCall',
        server: MEMORY_SERVER,
        tool: 'memory_write_page',
        status: 'completed',
        arguments: { path: 'agentes/x.md' },
      },
    },
  });
  assert.equal(cx[0].kind, 'memory');
  assert.equal(cx[0].label, 'Memória · memory_write_page');
  const oc = [];
  parser('opencode', (e) => oc.push(e)).accept({
    type: 'tool_use',
    part: { tool: MEMORY_SERVER + '_memory_query', callID: 'c1', state: { status: 'completed', input: {} } },
  });
  assert.equal(oc[0].kind, 'memory');
  assert.equal(memoryTools('claude', null).args.length, 0);
});
const exe = path.join(__dirname, '../runtime/ai-memory.exe');
test(
  'one HTTP server is shared by the app and an outside MCP client',
  { skip: !fs.existsSync(exe) && 'ai-memory.exe ausente', timeout: 60000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-mem-'));
    const m = new Memory(exe, dir);
    try {
      const ep = await m.agentEndpoint();
      assert.match(ep.mcp, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      const denied = await fetch(ep.mcp, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      assert.equal(denied.status, 401);
      await m.ensureProject('proj-x');
      // An agent-side client writes; the app's own query sees it, because both talk to the same server.
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const agent = new Client({ name: 'agent', version: '1' });
      await agent.connect(
        new StreamableHTTPClientTransport(new URL(ep.mcp), {
          requestInit: { headers: { Authorization: 'Bearer ' + ep.token } },
        })
      );
      const w = await agent.callTool({
        name: 'memory_write_page',
        arguments: {
          path: 'agentes/zebra.md',
          body: '# Zebra\n\nDecisão: usar a palavra quimera42 como marcador.',
          workspace: 'vesta',
          project: 'proj-x',
        },
      });
      assert.ok(!w.isError, JSON.stringify(w));
      await agent.close();
      assert.match(await m.query('quimera42', 'proj-x'), /zebra/i);
      assert.equal(fs.readFileSync(path.join(dir, 'vesta-server.pid'), 'utf8'), String(m.server.pid));
    } finally {
      await m.close();
    }
    // A healthy server left behind by a crashed run is adopted on the next start instead of fighting for the lock.
    const first = new Memory(exe, dir);
    await first.agentEndpoint();
    const orphan = first.server;
    orphan.removeAllListeners('exit');
    first.server = null;
    first.client = null;
    first.endpoint = null;
    const second = new Memory(exe, dir);
    try {
      await second.agentEndpoint();
      assert.equal(second.server, null, 'nothing new was spawned');
      assert.equal(second.adopted, orphan.pid);
      assert.match(await second.query('quimera42', 'proj-x'), /zebra/i);
    } finally {
      await second.close();
      try {
        orphan.kill();
      } catch {}
    }
  }
);

// ---- Memory + quest servers in one launch --------------------------------------------------------------------------
const qEndpoint = { url: 'http://127.0.0.1:50002', mcp: 'http://127.0.0.1:50002/mcp', token: 'quest-token-value' };
const both = (provider, mode = 'read') =>
  command({ provider, mode }, provider + '.exe', endpoint, { extra: [questServer(qEndpoint)] });
const questOnly = (provider, mode = 'read') =>
  command({ provider, mode }, provider + '.exe', null, { extra: [questServer(qEndpoint)] });
test('only-memory launches are unchanged by the multi-server support', () => {
  for (const provider of ['claude', 'codex', 'opencode']) {
    const old = memoryTools(provider, endpoint);
    const viaList = mcpTools(provider, [memoryServer(endpoint)]);
    assert.deepEqual(viaList, old);
    const c = command({ provider, mode: 'edit' }, provider + '.exe', endpoint);
    for (const a of old.args) assert.ok(c.args.includes(a));
    assert.ok(!c.args.join(' ').includes(QUEST_SERVER));
    assert.ok(!('VESTA_QUEST_TOKEN' in c.env));
  }
  const claude = memoryTools('claude', endpoint);
  assert.deepEqual(claude.args.slice(-2), ['--allowedTools', 'mcp__' + MEMORY_SERVER]);
  assert.deepEqual(Object.keys(JSON.parse(claude.args[1]).mcpServers), [MEMORY_SERVER]);
});
test('claude: one --mcp-config with both servers and both allowed, tokens only by environment', () => {
  const c = both('claude');
  const cfg = JSON.parse(c.args[c.args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(Object.keys(cfg.mcpServers), [MEMORY_SERVER, QUEST_SERVER]);
  assert.equal(cfg.mcpServers[QUEST_SERVER].url, qEndpoint.mcp);
  assert.equal(cfg.mcpServers[QUEST_SERVER].headers.Authorization, 'Bearer ${VESTA_QUEST_TOKEN}');
  assert.equal(c.args.filter((a) => a === '--mcp-config').length, 1);
  const i = c.args.indexOf('--allowedTools');
  assert.deepEqual(c.args.slice(i + 1, i + 3), ['mcp__' + MEMORY_SERVER, 'mcp__' + QUEST_SERVER]);
  assert.equal(c.env.VESTA_MEMORY_TOKEN, endpoint.token);
  assert.equal(c.env.VESTA_QUEST_TOKEN, qEndpoint.token);
  assert.ok(!c.args.join(' ').includes(qEndpoint.token));
  // The quest chat stays read-only, but not in plan mode (the model would refuse to use the tools): editing and running
  // tools are denied and nothing outside the MCP tools is allowed.
  assert.equal(c.args[c.args.indexOf('--permission-mode') + 1], 'default');
  const denied = c.args.slice(c.args.indexOf('--disallowedTools') + 1, c.args.indexOf('--mcp-config'));
  for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])
    assert.ok(denied.includes(t), t);
  assert.ok(!c.args.includes('--permission-prompt-tool'), 'no prompt channel: whatever is not allowed is refused');
  assert.ok(!c.args.includes('bypassPermissions'));
  const memoryOnlyRead = command({ provider: 'claude', mode: 'read' }, 'claude.exe', endpoint);
  assert.equal(
    memoryOnlyRead.args[memoryOnlyRead.args.indexOf('--permission-mode') + 1],
    'plan',
    'other read chats keep plan'
  );
  assert.ok(!memoryOnlyRead.args.includes('--disallowedTools'));
  const only = questOnly('claude');
  assert.deepEqual(Object.keys(JSON.parse(only.args[only.args.indexOf('--mcp-config') + 1]).mcpServers), [
    QUEST_SERVER,
  ]);
  assert.ok(!only.args.join(' ').includes(MEMORY_SERVER));
});
test('codex: the -c group is repeated per server; read-only sandbox stays', () => {
  const c = both('codex');
  for (const [name, ep] of [
    [MEMORY_SERVER, endpoint],
    [QUEST_SERVER, qEndpoint],
  ]) {
    assert.ok(c.args.includes('mcp_servers.' + name + '.url="' + ep.mcp + '"'));
    assert.ok(c.args.includes('mcp_servers.' + name + '.default_tools_approval_mode="approve"'));
  }
  assert.ok(c.args.includes('mcp_servers.' + QUEST_SERVER + '.bearer_token_env_var="VESTA_QUEST_TOKEN"'));
  assert.equal(c.args[0], 'app-server');
  assert.equal(c.thread.sandbox, 'read-only');
  assert.equal(c.env.VESTA_QUEST_TOKEN, qEndpoint.token);
  assert.ok(!c.args.join(' ').includes(qEndpoint.token));
});
test('opencode: one merged config, read mode still denies edit and bash only', () => {
  const c = both('opencode');
  const mcp = JSON.parse(c.env.OPENCODE_CONFIG_CONTENT).mcp;
  assert.deepEqual(Object.keys(mcp), [MEMORY_SERVER, QUEST_SERVER]);
  assert.equal(mcp[QUEST_SERVER].headers.Authorization, 'Bearer {env:VESTA_QUEST_TOKEN}');
  assert.ok(!c.env.OPENCODE_CONFIG_CONTENT.includes(qEndpoint.token));
  const permission = JSON.parse(c.env.OPENCODE_PERMISSION);
  assert.equal(permission.edit, 'deny');
  assert.equal(permission.bash, 'deny');
  assert.equal(c.agent, 'plan');
});
test('drael: allowed tools for both servers, quest tools allowed even in read mode', () => {
  const servers = [memoryServer(endpoint), questServer(qEndpoint)];
  const edit = drael.command({ provider: 'drael', mode: 'edit' }, 'x/bin/node.exe', servers, true);
  const i = edit.args.indexOf('--allowed-tools');
  assert.deepEqual(edit.args.slice(i + 1, i + 3), [MEMORY_SERVER + '__*', QUEST_SERVER + '__*']);
  const read = drael.command({ provider: 'drael', mode: 'read' }, 'x/bin/node.exe', servers);
  const j = read.args.indexOf('--allowed-tools');
  assert.deepEqual(read.args.slice(j + 1), [QUEST_SERVER + '__*'], 'memory stays out of read-only chats, as before');
  assert.equal(read.args[read.args.indexOf('--mode') + 1], 'plan');
  assert.deepEqual(read.servers, servers);
  const none = drael.command({ provider: 'drael', mode: 'edit' }, 'x/bin/node.exe', []);
  assert.ok(!none.args.includes('--allowed-tools'));
});
