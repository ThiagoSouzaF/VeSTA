// Claude Code stream-json events -> parser events (text, activities, subagent cards, background tasks, usage).
const { clip } = require('../../../util/text.cjs');
const { taskStatus } = require('../../../shared/tasks.cjs');
const { detailOf, toolKind, toolLabel, textOf, summarize, num } = require('../tool-display.cjs');
const { rateWindows } = require('../rate-windows.cjs');

function claudeHandler(core) {
  const { emit, append, startSub, subagent, activity, activityUpdate, cost, memoryCall, subs, bgList } = core;
  // Activities: tool_use ids announced as activities; tool_use ids that run as background tasks; task_id -> tool_use id.
  const toolIds = new Set(),
    bgTools = new Set(),
    taskTool = new Map();
  const trackBackground = (event) => {
    if (event.subtype === 'background_tasks_changed') {
      bgList.clear();
      for (const t of event.tasks || [])
        if (t?.task_id)
          bgList.set(t.task_id, {
            taskId: t.task_id,
            type: t.task_type || '',
            description: clip(t.description, 160),
          });
      emit({ type: 'tasks', tasks: core.listTasks() });
    } else if (event.subtype === 'task_started' && event.is_backgrounded && event.task_id) {
      bgList.set(event.task_id, {
        taskId: event.task_id,
        type: event.task_type || '',
        description: clip(event.description, 160),
        ...(event.tool_use_id ? { toolUseId: event.tool_use_id } : {}),
      });
    } else if (event.subtype === 'task_notification' && event.task_id) {
      bgList.delete(event.task_id);
    } else if (event.subtype === 'task_updated' && taskStatus(event.patch?.status) !== 'running' && event.task_id) {
      bgList.delete(event.task_id);
    }
  };
  const taskStats = (u) =>
    u ? { toolUses: num(u.tool_uses), tokens: num(u.total_tokens), durationMs: num(u.duration_ms) } : undefined;
  // `system` task events: subagents and background commands/monitors share task_id <-> tool_use_id.
  const claudeTask = (event) => {
    const id = event.tool_use_id || taskTool.get(event.task_id);
    if (event.subtype === 'task_started') {
      if (!id) return;
      taskTool.set(event.task_id, id);
      if (event.task_type === 'local_agent' || subs.has(id)) {
        if (!subs.has(id))
          startSub(
            id,
            { description: event.description, prompt: event.prompt, subagent_type: event.subagent_type },
            'running'
          );
        if (event.is_backgrounded) core.background.add(id);
        subagent({
          toolUseId: id,
          taskId: event.task_id,
          ...(event.is_backgrounded ? { background: true } : {}),
        });
      } else {
        bgTools.add(id);
        if (!toolIds.has(id)) {
          toolIds.add(id);
          activity('Segundo plano', event.description || '', { kind: 'command', id, status: 'running' });
        }
        activityUpdate(id, {
          background: true,
          taskId: event.task_id,
          status: 'running',
          ...(event.description ? { title: clip(event.description, 160) } : {}),
        });
      }
      return;
    }
    if (!id) return;
    const sub = subs.has(id);
    if (event.subtype === 'task_progress' && sub) {
      subagent({
        toolUseId: id,
        stats: { ...taskStats(event.usage), ...(event.last_tool_name ? { lastTool: event.last_tool_name } : {}) },
      });
    }
    if (event.subtype === 'task_updated') {
      const status = taskStatus(event.patch?.status);
      if (status === 'running') return;
      const endedAt = num(event.patch?.end_time) || undefined;
      if (sub) subagent({ toolUseId: id, status, endedAt });
      else if (toolIds.has(id)) activityUpdate(id, { status, endedAt });
    }
    if (event.subtype === 'task_notification') {
      const st = taskStatus(event.status),
        status = st === 'running' ? 'error' : st,
        summary = clip(event.summary || '', 4000) || undefined;
      if (sub) {
        core.background.delete(id);
        subagent({ toolUseId: id, status, result: summary, stats: taskStats(event.usage) });
      } else if (toolIds.has(id)) activityUpdate(id, { status, ...(summary ? { result: summary } : {}) });
    }
  };
  return function accept(event) {
    if (event.session_id) emit({ type: 'session', sessionId: event.session_id });
    // Events from inside a subagent carry parent_tool_use_id: they become live steps of its card, never main text.
    const parent = event.parent_tool_use_id;
    if (parent) {
      if (!subs.has(parent)) return;
      const step = (s) => subagent({ toolUseId: parent, step: s });
      if (event.type === 'assistant')
        for (const block of event.message?.content || []) {
          if (block.type === 'tool_use') {
            core.toolOwner.set(block.id, parent);
            const i = block.input || {};
            step({
              id: block.id,
              kind: toolKind(block.name),
              label: toolLabel(block.name),
              detail: clip(detailOf(i), 300),
              ...(i.description && i.description !== detailOf(i) ? { title: clip(i.description, 160) } : {}),
              status: 'running',
            });
          }
          if (block.type === 'text' && block.text?.trim())
            step({
              id: event.message?.id + ':text',
              kind: 'text',
              label: 'Escrevendo',
              detail: clip(block.text.trim(), 300),
              status: 'done',
            });
        }
      if (event.type === 'user' && Array.isArray(event.message?.content))
        for (const block of event.message.content)
          if (block?.type === 'tool_result')
            step({
              id: block.tool_use_id,
              status: block.is_error ? 'error' : 'done',
              result: clip(textOf(block.content), 400),
            });
      return;
    }
    if (
      event.type === 'stream_event' &&
      event.event?.type === 'content_block_delta' &&
      event.event.delta?.type === 'text_delta'
    ) {
      if (core.gap && !/\s$/.test(core.text)) append('\n\n');
      core.gap = false;
      append(event.event.delta.text);
    }
    if (event.type === 'assistant')
      for (const block of event.message?.content || []) {
        if (block.type === 'text' && !core.text) append(block.text);
        if (block.type === 'tool_use') {
          if (block.name === 'Agent' || block.name === 'Task') {
            if (!subs.has(block.id)) startSub(block.id, block.input, 'running');
          } else {
            const i = block.input || {},
              detail = detailOf(i);
            toolIds.add(block.id);
            memoryCall(block.name, i);
            if (i.run_in_background || block.name === 'Monitor') bgTools.add(block.id);
            activity(toolLabel(block.name), detail, {
              kind: toolKind(block.name),
              id: block.id,
              status: 'running',
              ...(i.description && i.description !== detail ? { title: clip(i.description, 160) } : {}),
              ...(i.run_in_background ? { background: true } : {}),
            });
          }
        }
      }
    if (event.type === 'user' && Array.isArray(event.message?.content))
      for (const block of event.message.content) {
        if (block?.type === 'tool_result' && toolIds.has(block.tool_use_id)) {
          // A tool launched in the background only acknowledges here; task_updated/task_notification ends it.
          const r = event.tool_use_result,
            taskId = r && typeof r === 'object' ? r.backgroundTaskId || r.taskId : '',
            id = block.tool_use_id;
          if (!block.is_error && (taskId || bgTools.has(id))) {
            bgTools.add(id);
            if (taskId) taskTool.set(taskId, id);
            activityUpdate(id, { background: true, ...(taskId ? { taskId } : {}) });
          } else
            activityUpdate(id, {
              status: block.is_error ? 'error' : 'done',
              result: clip(textOf(block.content), 600),
            });
        }
        if (block?.type === 'tool_result' && subs.has(block.tool_use_id)) {
          // A backgrounded subagent only acknowledges its launch here; task_notification closes it later.
          const body = textOf(block.content);
          if (!block.is_error && /^\s*Async agent launched/i.test(body)) {
            core.background.add(block.tool_use_id);
            subagent({ toolUseId: block.tool_use_id, background: true });
          } else
            subagent({
              toolUseId: block.tool_use_id,
              status: block.is_error ? 'error' : 'done',
              result: summarize(block.content),
            });
        }
      }
    if (event.type === 'system') {
      trackBackground(event);
      claudeTask(event);
    }
    // A second turn (after a background task) starts a new message: keep paragraphs apart.
    if (event.type === 'stream_event' && event.event?.type === 'message_start' && core.text) core.gap = true;
    if (event.type === 'rate_limit_event') {
      const w = rateWindows(event.rate_limit_info);
      if (w.fiveHour || w.sevenDay) emit({ type: 'usage', provider: 'claude', ...w });
    }
    // The empty turn a resumed process delivers first (a background task that died with the previous one) has nothing
    // to report; any other result adds the final text, usage and error.
    if (event.type === 'result' && !(event.num_turns === 0 && !event.result && !event.is_error)) {
      if (!core.text && event.result) append(event.result);
      const u = event.usage;
      if (u || event.total_cost_usd != null)
        cost({
          inputTokens: u?.input_tokens,
          outputTokens: u?.output_tokens,
          cacheTokens: num(u?.cache_read_input_tokens) + num(u?.cache_creation_input_tokens),
          costUsd: event.total_cost_usd,
        });
      if (event.is_error)
        emit({
          type: 'provider-error',
          message: (event.errors || []).join('\n') || event.result || 'Falha no Claude',
        });
    }
  };
}
module.exports = { claudeHandler };
