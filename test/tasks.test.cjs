// Unified task model: parsers (real captured events) -> stored message -> Task[] / tree / counts.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const providers = require('../electron/providers.cjs');
const T = require('../electron/tasks.cjs');

const fixture = (name) =>
  fs
    .readFileSync(path.join(__dirname, 'fixtures', name + '.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const newMessage = () => ({
  id: 'm1',
  role: 'assistant',
  createdAt: 1000,
  status: 'running',
  text: '',
  activities: [],
  subagents: [],
});
// Feeds provider events through the real parser and the same message updates the main process does.
function player(provider = 'claude') {
  const m = newMessage();
  let clock = 1000;
  const emitted = [];
  const p = providers.parser(provider, (ev) => {
    if (ev.type === 'text') m.text += ev.text;
    else {
      const out = providers.applyToMessage(m, ev, clock);
      if (out) emitted.push(out);
    }
  });
  return {
    m,
    p,
    emitted,
    at: (t) => (clock = t),
    feed: (events) => {
      for (const e of events) {
        clock += 10;
        p.accept(e);
      }
    },
    tasks: (live = true) => T.messageTasks({ id: 'c1', provider }, m, { live }),
  };
}
const byKind = (tasks, kind) => tasks.filter((t) => t.kind === kind);

test('claude real capture: background Bash, Monitor and two subagents become tasks with times', () => {
  const pl = player();
  const events = fixture('claude-background-monitor-subagents');
  const idx = (pred) => events.findIndex(pred);
  // Up to the Bash tool_result: the background command is still running (the result only acknowledges the launch).
  const bashResult = idx((e) => e.type === 'user' && e.tool_use_result?.backgroundTaskId);
  assert.ok(bashResult > 0);
  pl.feed(events.slice(0, bashResult + 1));
  let bash = pl.m.activities.find((a) => a.background);
  assert.equal(bash.status, 'running', 'launch acknowledgement must not close a background command');
  assert.equal(bash.taskId, 'blmprbzeo');
  assert.equal(bash.title, 'Sleep 20 seconds then echo bgdone');
  assert.ok(bash.startedAt && !bash.endedAt);
  // The rest of the capture: Monitor, subagents, task_updated / task_notification.
  pl.feed(events.slice(bashResult + 1));
  const tasks = pl.tasks(false);
  const bg = byKind(tasks, 'background')[0],
    mon = byKind(tasks, 'monitor')[0],
    subs = byKind(tasks, 'subagent');
  assert.equal(bg.status, 'done');
  assert.equal(bg.taskId, 'blmprbzeo');
  assert.equal(bg.label, 'Sleep 20 seconds then echo bgdone');
  assert.match(bg.extra.result, /completed \(exit code 0\)/);
  assert.equal(mon.status, 'done');
  assert.equal(mon.taskId, 'bwjp9twti');
  assert.equal(subs.length, 2);
  for (const s of subs) {
    assert.equal(s.status, 'done');
    assert.ok(s.stats.background && s.stats.toolUses === 1 && s.stats.tokens > 0);
    assert.ok(s.taskId && s.endedAt >= s.startedAt);
  }
  // Steps inside a subagent (parent_tool_use_id): Bash tool_use -> tool_result with its own times.
  const steps = tasks.filter((t) => t.parentId === subs[0].id);
  assert.ok(steps.some((s) => s.kind === 'command' && s.status === 'done' && s.endedAt >= s.startedAt));
  assert.ok(steps.every((s) => s.status !== 'running'));
  // Every non-subagent tool call was closed by its tool_result.
  assert.ok(pl.m.activities.every((a) => a.status === 'done' && a.endedAt >= a.startedAt));
  // Summary used by the message line and the Activity screen.
  const counts = T.countTasks(tasks);
  assert.equal(counts.subagents, 2);
  assert.equal(counts.background, 2);
  assert.equal(counts.running, 0);
  assert.equal(
    T.summaryLine({ subagents: 3, commands: 5, background: 1, tools: 0 }),
    '3 subagentes · 5 comandos · 1 em segundo plano'
  );
  assert.equal(
    T.summaryLine({ subagents: 1, commands: 1, background: 0, tools: 2 }),
    '1 subagente · 1 comando · 2 ferramentas'
  );
});

test('claude real capture: parallel subagents run concurrently and carry progress stats', () => {
  const pl = player();
  const events = fixture('claude-subagents-parallel');
  const started = events.filter((e) => e.subtype === 'task_started');
  assert.equal(started.length, 2);
  pl.feed(events.slice(0, events.indexOf(started[1]) + 1));
  assert.deepEqual(
    pl.m.subagents.map((s) => s.status),
    ['running', 'running'],
    'both subagents are live at the same time'
  );
  assert.deepEqual(
    pl.m.subagents.map((s) => s.taskId),
    started.map((e) => e.task_id)
  );
  assert.equal(T.countTasks(pl.tasks()).running, 2);
  pl.feed(events.slice(events.indexOf(started[1]) + 1));
  assert.ok(pl.m.subagents.every((s) => s.status === 'done' && s.stats.tokens > 0 && s.endedAt));
  assert.equal(pl.p.backgroundRunning(), false);
});

test('claude stop_task: task_updated killed and notification stopped end a background command as stopped', () => {
  const pl = player();
  pl.feed([
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'Bash',
            input: { command: 'sleep 300', description: 'Dormir', run_in_background: true },
          },
        ],
      },
    },
    {
      type: 'system',
      subtype: 'task_started',
      task_id: 'b1',
      tool_use_id: 'tu1',
      description: 'Dormir',
      is_backgrounded: true,
      task_type: 'local_bash',
    },
    {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Command running in background with ID: b1' }],
      },
      tool_use_result: { backgroundTaskId: 'b1' },
    },
  ]);
  assert.equal(pl.tasks()[1].status, 'running');
  assert.equal(pl.tasks()[1].kind, 'background');
  pl.feed([
    { type: 'system', subtype: 'task_updated', task_id: 'b1', patch: { status: 'killed', end_time: 5000 } },
    {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'b1',
      tool_use_id: 'tu1',
      status: 'stopped',
      summary: 'parado',
    },
  ]);
  const t = pl.tasks()[1];
  assert.equal(t.status, 'stopped');
  assert.equal(t.endedAt, 5000, 'uses the CLI end_time');
});

test('a background command that outlives the turn is detached, not faked as done; stopping ends everything', () => {
  const mk = () => {
    const pl = player();
    pl.feed([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'sleep 600', run_in_background: true } },
          ],
        },
      },
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'b1',
        tool_use_id: 'tu1',
        is_backgrounded: true,
        task_type: 'local_bash',
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: 'a.txt' } }] },
      },
    ]);
    return pl;
  };
  const done = mk();
  T.settleMessage(done.m, 'done', 9000);
  done.m.status = 'done';
  const [bg, read] = done.m.activities;
  assert.equal(bg.status, 'running');
  assert.equal(bg.detached, true);
  assert.equal(read.status, 'done');
  assert.equal(read.endedAt, 9000);
  const c = T.countTasks(done.tasks(false));
  assert.equal(c.running, 0, 'detached commands are not counted as running');
  assert.equal(c.detached, 1);
  const stopped = mk();
  T.settleMessage(stopped.m, 'stopped', 9000);
  assert.deepEqual(
    stopped.m.activities.map((a) => a.status),
    ['stopped', 'stopped']
  );
  const failed = mk();
  T.settleMessage(failed.m, 'error', 9000);
  assert.equal(failed.m.activities[0].status, 'error');
});

test('a message left running by a crash shows as stopped, never as live work', () => {
  const pl = player();
  pl.feed([
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] },
    },
  ]);
  const live = pl.tasks(true);
  assert.deepEqual(
    live.map((t) => t.status),
    ['running', 'running']
  );
  const stale = pl.tasks(false);
  assert.deepEqual(
    stale.map((t) => t.status),
    ['stopped', 'stopped']
  );
});

test('limits fold old finished work into a count and never drop running tasks', () => {
  const list = [];
  for (let i = 0; i < 12; i++) list.push({ id: 'a' + i, status: i === 1 ? 'running' : 'done' });
  const dropped = T.capList(list, 5);
  assert.equal(dropped, 7);
  assert.equal(list.length, 5);
  assert.ok(
    list.some((x) => x.id === 'a1'),
    'the old running task survives'
  );
  const m = newMessage();
  for (let i = 0; i < 450; i++)
    providers.applyToMessage(
      m,
      { type: 'activity', id: 'x' + i, label: 'L', status: i === 0 ? 'running' : 'done' },
      100 + i
    );
  assert.equal(m.activities.length, T.MAX_ACTIVITIES);
  assert.equal(m.activitiesDropped, 50);
  assert.equal(m.activities[0].id, 'x0', 'running x0 stays');
  const turn = T.messageTasks({ id: 'c' }, m)[0];
  assert.equal(turn.stats.omitted, 50);
  const sub = [];
  for (let i = 0; i < T.MAX_STEPS + 30; i++)
    providers.upsertSubagent(sub, { toolUseId: 's', step: { id: 'st' + i, status: 'done', label: 'x' } }, 100 + i);
  assert.equal(sub[0].steps.length, T.MAX_STEPS);
  assert.equal(sub[0].stepsDropped, 30);
});

test('upsert stamps startedAt/endedAt on activities and steps and clears endedAt when work resumes', () => {
  const list = [];
  providers.upsertActivity(list, { type: 'activity', id: 'i', label: 'Cmd', status: 'running' }, 100);
  assert.deepEqual([list[0].startedAt, list[0].endedAt], [100, undefined]);
  providers.upsertActivity(list, { type: 'activity', id: 'i', status: 'done', result: 'ok' }, 250);
  assert.deepEqual([list[0].startedAt, list[0].endedAt, list[0].label, list[0].result], [100, 250, 'Cmd', 'ok']);
  providers.upsertActivity(list, { type: 'activity', id: 'i', status: 'running' }, 300);
  assert.equal(list[0].endedAt, undefined);
  const subs = [];
  providers.upsertSubagent(subs, { toolUseId: 's', status: 'running' }, 100);
  providers.upsertSubagent(subs, { toolUseId: 's', step: { id: 'a', status: 'running', label: 'x' } }, 120);
  providers.upsertSubagent(subs, { toolUseId: 's', step: { id: 'a', status: 'done' } }, 180);
  assert.deepEqual([subs[0].steps[0].startedAt, subs[0].steps[0].endedAt], [120, 180]);
});

test('subagent events ship only the step that changed', () => {
  const m = newMessage();
  providers.applyToMessage(m, { type: 'subagent', toolUseId: 's', status: 'running' }, 1);
  providers.applyToMessage(
    m,
    { type: 'subagent', toolUseId: 's', step: { id: 'a', status: 'running', label: 'a' } },
    2
  );
  const out = providers.applyToMessage(
    m,
    { type: 'subagent', toolUseId: 's', step: { id: 'b', status: 'running', label: 'b' } },
    3
  );
  assert.equal(out.subagent.steps, undefined);
  assert.equal(out.subagent.step.id, 'b');
  assert.equal(m.subagents[0].steps.length, 2);
});

test('codex: commands, file changes, MCP calls, web search and a subagent thread are tasks with times', () => {
  const pl = player('codex');
  const n = (method, params) => ({ method, params });
  pl.feed([
    n('thread/started', { thread: { id: 'main' } }),
    n('item/started', { threadId: 'main', item: { type: 'commandExecution', id: 'c1', command: 'npm test' } }),
    n('item/started', { threadId: 'main', item: { type: 'webSearch', id: 'w1', query: 'vite' } }),
    n('item/started', { threadId: 'main', item: { type: 'mcpToolCall', id: 'k1', server: 'srv', tool: 'go' } }),
    n('item/started', {
      threadId: 'main',
      item: {
        type: 'collabAgentToolCall',
        id: 'sp',
        tool: 'spawnAgent',
        prompt: 'achar bug',
        receiverThreadIds: ['t2'],
      },
    }),
    n('thread/started', { thread: { id: 't2', parentThreadId: 'main', agentNickname: 'Ada' } }),
    n('item/started', { threadId: 't2', item: { type: 'commandExecution', id: 'sc1', command: 'ls' } }),
  ]);
  let tasks = pl.tasks();
  assert.deepEqual(
    tasks.slice(1).map((t) => t.kind + ':' + t.status),
    ['command:running', 'web:running', 'mcp:running', 'subagent:running', 'command:running']
  );
  assert.equal(tasks[5].parentId, tasks[4].id, 'subagent thread work nests under its card');
  pl.feed([
    n('item/completed', {
      threadId: 'main',
      item: {
        type: 'commandExecution',
        id: 'c1',
        command: 'npm test',
        status: 'completed',
        aggregatedOutput: 'ok 5 tests',
      },
    }),
    n('item/completed', { threadId: 'main', item: { type: 'webSearch', id: 'w1', query: 'vite' } }),
    n('item/completed', {
      threadId: 'main',
      item: { type: 'mcpToolCall', id: 'k1', server: 'srv', tool: 'go', status: 'failed' },
    }),
    n('item/completed', {
      threadId: 't2',
      item: { type: 'commandExecution', id: 'sc1', command: 'ls', status: 'completed' },
    }),
    n('item/completed', {
      threadId: 'main',
      item: {
        type: 'collabAgentToolCall',
        id: 'w',
        tool: 'wait',
        agentsStates: { t2: { status: 'completed', message: 'pronto' } },
      },
    }),
  ]);
  tasks = pl.tasks();
  assert.deepEqual(
    tasks.slice(1).map((t) => t.status),
    ['done', 'done', 'error', 'done', 'done']
  );
  assert.ok(tasks.slice(1).every((t) => t.endedAt >= t.startedAt));
  assert.equal(tasks[1].extra.result, 'ok 5 tests');
  assert.equal(tasks[4].extra.result, 'pronto');
});

test('opencode tool states and drael tool results map to running/done/error', () => {
  const oc = player('opencode');
  const tool = (state, tool = 'bash') => ({ type: 'tool_use', part: { callID: 'k1', tool, state } });
  oc.feed([
    tool({ status: 'pending', input: { command: 'ls' } }),
    tool({ status: 'running', input: { command: 'ls' } }),
  ]);
  assert.equal(oc.tasks()[1].status, 'running');
  oc.feed([tool({ status: 'completed', input: { command: 'ls' }, output: 'a b' })]);
  assert.deepEqual([oc.tasks()[1].status, oc.tasks()[1].extra.result, oc.tasks().length], ['done', 'a b', 2]);
  const ocTask = player('opencode');
  ocTask.feed([
    {
      type: 'tool_use',
      part: {
        callID: 's1',
        tool: 'task',
        state: { status: 'running', input: { description: 'Revisar', prompt: 'x', subagent_type: 'general' } },
      },
    },
  ]);
  assert.equal(ocTask.tasks()[1].kind, 'subagent');
  const dr = player('drael');
  dr.feed([{ type: 'tool', name: 'bash', args: { command: 'ls' } }]);
  assert.equal(dr.tasks()[1].status, 'running');
  dr.feed([{ type: 'result', name: 'bash', text: 'out' }]);
  assert.deepEqual(
    [dr.tasks()[1].status, dr.tasks()[1].kind, dr.tasks()[1].extra.result, dr.tasks().length],
    ['done', 'command', 'out', 2]
  );
  dr.feed([
    { type: 'tool', name: 'bash', args: {} },
    { type: 'result', name: 'bash', error: true, text: 'falhou' },
  ]);
  assert.equal(dr.tasks()[2].status, 'error');
});

test('buildTree nests steps under subagents and subagents under the turn; statuses map from CLI words', () => {
  const pl = player();
  pl.feed(fixture('claude-subagents-parallel'));
  const root = T.buildTree(pl.tasks(false))[0];
  assert.equal(root.task.kind, 'turn');
  assert.equal(root.children.length, 2);
  assert.ok(root.children.every((c) => c.task.kind === 'subagent' && c.children.length > 0));
  assert.deepEqual(
    ['completed', 'failed', 'killed', 'stopped', 'interrupted', 'running', 'shutdown', 'notFound'].map(T.taskStatus),
    ['done', 'error', 'stopped', 'stopped', 'stopped', 'running', 'done', 'error']
  );
});

test('driver: stopTask sends a stop_task control request while Claude is alive, and refuses after the turn settled', async () => {
  const drivers = require('../electron/drivers.cjs');
  const script = [
    "const rl = require('readline').createInterface({ input: process.stdin });",
    'const out = (o) => process.stdout.write(JSON.stringify(o) + String.fromCharCode(10));',
    "rl.on('line', (l) => {",
    '  const m = JSON.parse(l);',
    "  if (m.type === 'user') out({ type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'tu1', task_type: 'local_bash', is_backgrounded: true });",
    "  if (m.type === 'control_request' && m.request.subtype === 'stop_task') {",
    "    out({ type: 'system', subtype: 'task_updated', task_id: m.request.task_id, patch: { status: 'killed', end_time: 7 } });",
    "    out({ type: 'result', num_turns: 1, result: 'ok', is_error: false });",
    '  }',
    '});',
  ].join('\n');
  const seen = [];
  const parse = providers.parser('claude', (e) => seen.push(e));
  parse.accept({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { run_in_background: true } }] },
  });
  const run = drivers.start(
    'claude',
    { exe: process.execPath, args: ['-e', script] },
    { cwd: process.cwd(), env: process.env, prompt: 'x', parse, lingerMs: 50, ask: async () => ({ allow: false }) }
  );
  const t0 = Date.now();
  while (!seen.some((e) => e.type === 'activity' && e.taskId === 't1') && Date.now() - t0 < 5000)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(run.stopTask(''), false, 'needs a task id');
  assert.equal(run.stopTask('t1'), true);
  const done = await run.done;
  assert.equal(done.code, 0, done.stderr + JSON.stringify(seen.map((e) => e.type + ':' + (e.status || ''))));
  assert.ok(
    seen.some((e) => e.type === 'activity' && e.status === 'stopped'),
    'the CLI confirmation closes the task as stopped'
  );
  assert.equal(run.stopTask('t1'), false, 'after the turn settled the process is gone');
});
