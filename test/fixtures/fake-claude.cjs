// Stand-in for `claude --print --input-format stream-json` used by the follow tests. Behaviour verified against the
// real CLI: a background Bash task survives the turn; when it ends the CLI sends task_updated/task_notification and
// starts a turn on its own (system/init + assistant + result) without any user message.
//   FAKE_MODE   auto (default) = the CLI starts the turn by itself | quiet = it does not (VeSTA must nudge it)
//   FAKE_DELAY  ms until the background task ends (default 250)
const rl = require('node:readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify({ session_id: 'sess-1', ...o }) + '\n');
const mode = process.env.FAKE_MODE || 'auto',
  delay = Number(process.env.FAKE_DELAY || 250);
let turn = 0,
  running = false;
const say = (text) => {
  out({ type: 'stream_event', event: { type: 'message_start' } });
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  out({ type: 'assistant', message: { id: 'm' + turn, content: [{ type: 'text', text }] } });
  out({
    type: 'result',
    subtype: 'success',
    num_turns: 1,
    result: text,
    total_cost_usd: 0.001,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
};
const finish = (status = 'completed') => {
  if (!running) return;
  running = false;
  out({ type: 'system', subtype: 'task_updated', task_id: 't1', patch: { status, end_time: Date.now() } });
  out({
    type: 'system',
    subtype: 'task_notification',
    task_id: 't1',
    tool_use_id: 'toolu_1',
    status,
    summary: 'Background command "dorme" ' + status,
  });
  out({ type: 'system', subtype: 'background_tasks_changed', tasks: [] });
  if (mode === 'auto') {
    turn++;
    out({ type: 'system', subtype: 'init' });
    say('PRONTO-123 retorno do processo');
  }
};
rl.on('line', (l) => {
  const e = JSON.parse(l);
  if (e.type === 'control_request' && e.request?.subtype === 'stop_task') {
    out({ type: 'control_response', response: { subtype: 'success', request_id: e.request_id } });
    finish('stopped');
    return;
  }
  if (e.type !== 'user') return;
  const c = e.message.content;
  const text = typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join('');
  turn++;
  if (process.env.FAKE_DUMP)
    require('node:fs').appendFileSync(
      process.env.FAKE_DUMP,
      JSON.stringify({ text, owner: process.env.AI_MEMORY_CAPTURE_OWNER || '' }) + String.fromCharCode(10)
    );
  out({ type: 'system', subtype: 'init' });
  if (turn === 1 && !/sem processo/.test(text)) {
    running = true;
    out({
      type: 'assistant',
      message: {
        id: 'a0',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Bash',
            input: { command: 'sleep 1', run_in_background: true, description: 'dorme' },
          },
        ],
      },
    });
    out({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 't1', task_type: 'local_bash', description: 'dorme' }],
    });
    out({
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      tool_use_id: 'toolu_1',
      description: 'dorme',
      is_backgrounded: true,
      task_type: 'local_bash',
    });
    out({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'started' }] },
      tool_use_result: { backgroundTaskId: 't1' },
    });
    say('iniciado');
    setTimeout(() => finish(), delay);
  } else say('resposta ' + turn + ' pid ' + process.pid + ': ' + text.slice(0, 40));
});
rl.on('close', () => process.exit(0));
