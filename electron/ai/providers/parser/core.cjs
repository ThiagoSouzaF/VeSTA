// State and emit helpers every provider handler shares: the streamed text, subagent cards, background tasks,
// Codex thread bookkeeping. Handlers (claude/codex/opencode/drael) read and write it; the parser object exposes it.
const { clip } = require('../../../util/text.cjs');
const { MEMORY_SERVER } = require('../mcp-servers.cjs');
const { num } = require('../tool-display.cjs');

function createCore(provider, emit) {
  const core = {
    provider,
    emit,
    text: '',
    // Claude: a new message after a background task starts a new paragraph. Codex: same between agent messages.
    gap: false,
    paragraph: false,
    // Codex app-server: the chat's own thread, subagent threads -> their card / label.
    mainThread: null,
    threadOwner: new Map(),
    threadLabel: new Map(),
    // Subagent cards started (tool_use id / thread id) and their short labels.
    subs: new Set(),
    subLabels: new Map(),
    // Claude: tool_use id -> the subagent card it runs under, so a permission request can say who is asking.
    toolOwner: new Map(),
    background: new Set(),
    // Claude background tasks (commands, monitors) the CLI is still tracking: task_id -> {taskId, type, description}.
    // `background_tasks_changed` is authoritative; task_started/task_notification keep the list right in between.
    bgList: new Map(),
  };
  core.append = (t) => {
    if (!t) return;
    core.text += t;
    emit({ type: 'text', text: t });
  };
  core.activity = (label, detail, extra = {}) =>
    emit({ type: 'activity', label, detail: clip(detail, 3000), kind: 'tool', ...extra });
  core.subagent = (o) => emit({ type: 'subagent', provider, ...o });
  // Partial update of an activity already announced (merged by id): status, result, background flags.
  core.activityUpdate = (id, o) => emit({ type: 'activity', id, ...o });
  core.cost = (o) =>
    emit({
      type: 'cost',
      provider,
      inputTokens: num(o.inputTokens),
      outputTokens: num(o.outputTokens),
      cacheTokens: num(o.cacheTokens),
      costUsd: num(o.costUsd),
    });
  core.startSub = (id, input, status, result) => {
    core.subs.add(id);
    core.subLabels.set(
      id,
      clip(input?.description || String(input?.prompt || '').split('\n')[0] || input?.subagent_type || 'subagente', 120)
    );
    core.subagent({
      toolUseId: id,
      subagentType: clip(input?.subagent_type || input?.subagentType || 'agent', 80),
      label: clip(input?.description || String(input?.prompt || '').split('\n')[0], 200),
      prompt: clip(input?.prompt, 6000),
      status,
      ...(result !== undefined ? { result } : {}),
    });
  };
  core.listTasks = () => [...core.bgList.values()].filter((t) => t.type !== 'local_agent');
  // A write to the AI Memory (by the agent itself) is reported so the app can show where a profile entry came from.
  const memoryWrites = new Set();
  core.memoryCall = (name, input, key) => {
    if (key) {
      if (memoryWrites.has(key)) return;
      if (/memory_write_page$/.test(String(name || ''))) memoryWrites.add(key);
    }
    if (!String(name || '').includes(MEMORY_SERVER) && !/vesta_memory/.test(String(name || ''))) return;
    if (!/memory_write_page$/.test(String(name))) return;
    emit({
      type: 'memory-write',
      path: clip(input?.path, 300),
      scope: input?.scope || '',
      body: clip(input?.body, 2000),
    });
  };
  return core;
}
module.exports = { createCore };
