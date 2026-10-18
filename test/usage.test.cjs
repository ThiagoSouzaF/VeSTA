const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { parser, upsertSubagent, upsertActivity, rateWindows, command } = require('../electron/providers.cjs');
const usage = require('../electron/usage.cjs');
const { Store } = require('../electron/store.cjs');
const run = (provider, events) => {
  const out = [];
  const p = parser(provider, (e) => out.push(e));
  for (const e of events) p.accept(e);
  return out;
};
test('claude Agent tool_use becomes a running subagent and tool_result closes it', () => {
  const out = run('claude', [
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'Agent',
            input: { description: 'Achar bug', prompt: 'Procure o bug\nem x', subagent_type: 'Explore' },
          },
        ],
      },
    },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { description: 'Achar bug' } }] },
    },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu1',
            content: [{ type: 'text', text: '[Subagent hand-back] Achei em y.js' }],
          },
          { type: 'tool_result', tool_use_id: 'other', content: 'x' },
        ],
      },
    },
  ]);
  const subs = out.filter((e) => e.type === 'subagent');
  assert.equal(subs.length, 2);
  assert.deepEqual(
    { t: subs[0].toolUseId, s: subs[0].status, ty: subs[0].subagentType, l: subs[0].label, p: subs[0].provider },
    { t: 'tu1', s: 'running', ty: 'Explore', l: 'Achar bug', p: 'claude' }
  );
  assert.equal(subs[1].status, 'done');
  assert.equal(subs[1].result, 'Achei em y.js');
  assert.equal(out.filter((e) => e.type === 'activity').length, 0);
});
test('claude tool_result with is_error marks subagent as error; other tools stay activities with kind', () => {
  const out = run('claude', [
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'a', name: 'Agent', input: { prompt: 'p' } },
          { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_use', id: 'c', name: 'mcp__x__y', input: {} },
        ],
      },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'falhou' }] },
    },
  ]);
  assert.equal(out.find((e) => e.type === 'subagent' && e.status === 'error').result, 'falhou');
  assert.deepEqual(
    out.filter((e) => e.type === 'activity').map((e) => e.kind),
    ['command', 'mcp']
  );
});
test('opencode task tool becomes a subagent; completed arrives done with result', () => {
  const out = run('opencode', [
    {
      type: 'tool_use',
      part: {
        tool: 'task',
        callID: 'c1',
        state: {
          status: 'completed',
          input: { description: 'Revisar', prompt: 'faça', subagent_type: 'general' },
          output: 'ok feito',
        },
      },
    },
    { type: 'tool_use', part: { tool: 'bash', callID: 'c2', state: { status: 'completed', title: 'ls' } } },
  ]);
  const s = out.find((e) => e.type === 'subagent');
  assert.equal(s.status, 'done');
  assert.equal(s.subagentType, 'general');
  assert.equal(s.result, 'ok feito');
  assert.equal(s.toolUseId, 'c1');
  assert.equal(out.find((e) => e.type === 'activity').kind, 'command');
});
test('rate_limit_event is normalized (seconds, ms, percent, alternate names)', () => {
  const out = run('claude', [
    {
      type: 'rate_limit_event',
      rate_limit_info: {
        unifiedWindows: {
          five_hour: { utilization: 0.25, resetsAt: 1800000000 },
          seven_day: { utilization: 40, resetsAt: 1800000000000 },
        },
      },
    },
  ]);
  const u = out.find((e) => e.type === 'usage');
  assert.deepEqual(u.fiveHour, { utilization: 0.25, resetsAt: 1800000000000 });
  assert.deepEqual(u.sevenDay, { utilization: 0.4, resetsAt: 1800000000000 });
  const w = rateWindows({ rateLimitType: 'five_hour', utilization: 0.1, resetsAt: 1800000000 });
  assert.equal(w.fiveHour.utilization, 0.1);
  assert.equal(w.sevenDay, null);
  assert.equal(run('claude', [{ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }]).length, 0);
});
test('claude result, opencode step_finish and codex turn.completed emit cost', () => {
  const c = run('claude', [
    {
      type: 'result',
      result: 'oi',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
      total_cost_usd: 0.12,
    },
  ]).find((e) => e.type === 'cost');
  assert.deepEqual([c.provider, c.inputTokens, c.outputTokens, c.cacheTokens, c.costUsd], ['claude', 10, 5, 120, 0.12]);
  const o = run('opencode', [
    {
      type: 'step_finish',
      part: { tokens: { input: 7, output: 3, reasoning: 1, cache: { read: 4, write: 2 } }, cost: 0.01 },
    },
  ]).find((e) => e.type === 'cost');
  assert.deepEqual([o.inputTokens, o.outputTokens, o.cacheTokens, o.costUsd], [7, 4, 6, 0.01]);
  const x = run('codex', [
    { method: 'thread/started', params: { thread: { id: 't1' } } },
    {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 't1',
        tokenUsage: { last: { inputTokens: 30, cachedInputTokens: 6, outputTokens: 5, reasoningOutputTokens: 1 } },
      },
    },
    {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 't1',
        tokenUsage: { last: { inputTokens: 20, cachedInputTokens: 4, outputTokens: 3, reasoningOutputTokens: 1 } },
      },
    },
    { method: 'turn/completed', params: { threadId: 't1', turn: { status: 'completed' } } },
  ]).find((e) => e.type === 'cost');
  assert.deepEqual([x.inputTokens, x.outputTokens, x.cacheTokens], [50, 10, 10]);
});
test('upsert helpers merge by id and stamp times', () => {
  const list = [];
  upsertSubagent(list, { type: 'subagent', toolUseId: '1', status: 'running', label: 'a', prompt: 'p' }, 100);
  const r = upsertSubagent(
    list,
    { type: 'subagent', toolUseId: '1', status: 'done', result: 'r', prompt: undefined },
    250
  );
  assert.equal(list.length, 1);
  assert.deepEqual([r.startedAt, r.endedAt, r.prompt, r.result], [100, 250, 'p', 'r']);
  const acts = [];
  upsertActivity(acts, { type: 'activity', id: 'i', label: 'Executando comando', status: 'running' });
  upsertActivity(acts, { type: 'activity', id: 'i', label: 'Comando concluído', status: 'done' });
  assert.equal(acts.length, 1);
  assert.equal(acts[0].status, 'done');
});
test('usage accumulates per day/provider and store merges old state', () => {
  const u = usage.emptyUsage(),
    t = new Date(2026, 9, 15, 12).getTime();
  usage.recordCost(u, { provider: 'claude', inputTokens: 1, outputTokens: 2, cacheTokens: 3, costUsd: 0.5 }, t);
  usage.recordCost(u, { provider: 'claude', inputTokens: 1, outputTokens: 0, cacheTokens: 0, costUsd: 0.25 }, t);
  assert.deepEqual(u.daily['2026-10-15'].claude, {
    inputTokens: 2,
    outputTokens: 2,
    cacheTokens: 3,
    costUsd: 0.75,
    turns: 2,
  });
  usage.recordRateLimit(u, { fiveHour: { utilization: 0.5, resetsAt: 1 } }, t);
  usage.recordRateLimit(u, { sevenDay: { utilization: 0.1, resetsAt: 2 } }, t);
  const win = (id) => u.rateLimit.claude.windows.find((w) => w.id === id);
  assert.equal(win('five_hour').utilization, 0.5);
  assert.equal(win('seven_day').utilization, 0.1);
  assert.equal(u.rateLimit.claude.updatedAt, t);
  assert.equal(usage.summary(u, t).today.claude.turns, 2);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-usage-'));
  fs.writeFileSync(path.join(dir, 'vesta.json'), JSON.stringify({ version: 1, chats: [] }));
  const s = new Store(dir);
  assert.deepEqual(s.state.usage.daily, {});
  assert.deepEqual(s.state.usage.rateLimit, {});
});
test('claude subagent inner events become live steps, never main text', () => {
  const out = run('claude', [
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu1', name: 'Agent', input: { description: 'Listar', subagent_type: 'Explore' } },
        ],
      },
    },
    {
      type: 'assistant',
      parent_tool_use_id: 'tu1',
      message: { id: 'm2', content: [{ type: 'tool_use', id: 'g1', name: 'Glob', input: { pattern: '*' } }] },
    },
    {
      type: 'user',
      parent_tool_use_id: 'tu1',
      message: { content: [{ type: 'tool_result', tool_use_id: 'g1', content: 'a.txt' }] },
    },
    { type: 'assistant', parent_tool_use_id: 'tu1', message: { id: 'm3', content: [{ type: 'text', text: 'a.txt' }] } },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu1',
            content:
              'The text below is the final report of a subagent.\nThe report follows:\n  Achei a.txt\n  Total: 1',
          },
        ],
      },
    },
  ]);
  assert.equal(out.filter((e) => e.type === 'text').length, 0);
  const list = [];
  for (const e of out.filter((e) => e.type === 'subagent')) upsertSubagent(list, e);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'done');
  assert.equal(list[0].result, 'Achei a.txt\nTotal: 1');
  assert.deepEqual(
    list[0].steps.map((s) => [s.id, s.kind, s.status]),
    [
      ['g1', 'search', 'done'],
      ['m3:text', 'text', 'done'],
    ]
  );
});
test('rate limit top-level window does not erase utilization from unifiedWindows', () => {
  const w = rateWindows({
    resetsAt: 1792080600,
    rateLimitType: 'five_hour',
    unifiedWindows: {
      five_hour: { utilization: 0.1, resetsAt: 1792080600 },
      seven_day: { utilization: 0.12, resetsAt: 1792468800 },
    },
  });
  assert.equal(w.fiveHour.utilization, 0.1);
  assert.equal(w.fiveHour.resetsAt, 1792080600000);
  assert.equal(w.sevenDay.utilization, 0.12);
});
test('claude background subagent stays running until task_notification', () => {
  const out = run('claude', [
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu9', name: 'Agent', input: { description: 'Bg', run_in_background: true } },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu9',
            content: [{ type: 'text', text: 'Async agent launched successfully. agentId: x' }],
          },
        ],
      },
    },
    { type: 'stream_event', event: { type: 'message_start' } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Lancei.' } } },
    {
      type: 'system',
      subtype: 'task_progress',
      tool_use_id: 'tu9',
      usage: { tool_uses: 1, total_tokens: 100, duration_ms: 5 },
    },
    {
      type: 'system',
      subtype: 'task_notification',
      tool_use_id: 'tu9',
      status: 'completed',
      summary: 'oi',
      usage: { tool_uses: 1, total_tokens: 150, duration_ms: 9 },
    },
    { type: 'stream_event', event: { type: 'message_start' } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Pronto.' } } },
  ]);
  const list = [];
  const states = [];
  for (const e of out.filter((e) => e.type === 'subagent')) {
    upsertSubagent(list, e);
    states.push(list[0].status);
  }
  assert.deepEqual(states, ['running', 'running', 'running', 'done']);
  assert.equal(list[0].background, true);
  assert.equal(list[0].result, 'oi');
  assert.equal(list[0].stats.tokens, 150);
  assert.equal(
    out
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join(''),
    'Lancei.\n\nPronto.'
  );
});
test('store v1 migrates every existing chat to full edit once; new chats default to edit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omph-mig-'));
  fs.writeFileSync(
    path.join(dir, 'vesta.json'),
    JSON.stringify({
      version: 1,
      settings: {},
      projects: [],
      chats: [
        { id: 'a', mode: 'read', messages: [] },
        { id: 'b', mode: 'edit', messages: [] },
      ],
      memories: [],
    })
  );
  let s = new Store(dir);
  assert.equal(s.state.version, 3);
  assert.deepEqual(
    s.state.chats.map((c) => c.mode),
    ['edit', 'edit']
  );
  s.state.chats[0].mode = 'read';
  s.save();
  s = new Store(dir);
  assert.equal(s.state.chats[0].mode, 'read', 'a user choice made after the migration must survive restarts');
  assert.equal(s.addChat({ provider: 'claude' }).mode, 'edit');
  assert.equal(s.addChat({ provider: 'claude', mode: 'read' }).mode, 'read');
});
test('edit mode gives full access in every provider', () => {
  const args = (p) => command({ provider: p, mode: 'edit', model: 'm1' }, 'exe').args.join(' ');
  assert.match(args('claude'), /--permission-mode bypassPermissions/);
  assert.match(args('claude'), /--model m1/);
  assert.deepEqual(command({ provider: 'codex', mode: 'edit' }, 'exe').thread, {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  });
  assert.match(command({ provider: 'claude', mode: 'read' }, 'exe').args.join(' '), /--permission-mode plan/);
});
