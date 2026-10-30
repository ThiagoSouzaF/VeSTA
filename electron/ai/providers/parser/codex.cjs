// Codex app-server JSON-RPC notifications ({method, params}) -> parser events.
const { clip } = require('../../../util/text.cjs');
const { taskStatus } = require('../../../shared/tasks.cjs');
const { plainCommand } = require('../../permissions.cjs');
const { codexRateLimits } = require('../../usage.cjs');
const { MEMORY_SERVER, QUEST_SERVER } = require('../mcp-servers.cjs');
const { toolLabel, num } = require('../tool-display.cjs');

// One Codex app-server item -> activity fields (label, detail, kind, status); null for items shown elsewhere.
function codexItem(it, done) {
  const status = !done ? 'running' : ['failed', 'declined'].includes(it.status) ? 'error' : 'done';
  if (it.type === 'commandExecution')
    return {
      label: done ? (it.status === 'declined' ? 'Comando negado' : 'Comando concluído') : 'Executando comando',
      detail: plainCommand(it.command),
      kind: 'command',
      status,
      ...(done && it.aggregatedOutput ? { result: clip(it.aggregatedOutput, 600) } : {}),
    };
  if (it.type === 'fileChange')
    return {
      label: done ? (it.status === 'declined' ? 'Alteração negada' : 'Arquivos atualizados') : 'Alterando arquivos',
      detail: (it.changes || []).map((x) => x.path).join(', '),
      kind: 'file',
      status,
    };
  if (it.type === 'mcpToolCall' && it.server === QUEST_SERVER)
    return { label: 'Quest · ' + it.tool, detail: it.arguments?.stepId || '', kind: 'mcp', status };
  if (it.type === 'mcpToolCall') {
    const mem = it.server === MEMORY_SERVER;
    return {
      label: mem ? toolLabel(MEMORY_SERVER + '_' + it.tool) : 'Consultando ferramenta',
      detail: mem ? it.arguments?.query || it.arguments?.path || '' : [it.server, it.tool].filter(Boolean).join(' · '),
      kind: mem ? 'memory' : 'mcp',
      status,
    };
  }
  if (it.type === 'webSearch') return { label: 'Pesquisando na web', detail: it.query, kind: 'web', status };
  if (it.type === 'dynamicToolCall')
    return { label: 'Usando ' + (it.tool || it.name || 'ferramenta'), detail: '', kind: 'tool', status };
  return null;
}

function codexHandler(core) {
  const { emit, append, startSub, subagent, activity, cost, memoryCall, subs, threadOwner, threadLabel } = core;
  // Streamed message items (their completion must not repeat the text) and the turn's token usage.
  const streamed = new Set(),
    usage = { inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
  return function accept(event) {
    const m = event.method,
      p = event.params || {},
      it = p.item,
      tid = p.threadId || p.thread?.id;
    // Rate limits arrive as a notification (account/rateLimits/updated) and as the read response (replace = full list).
    if (m === 'account/rateLimits/updated' || m === 'account/rateLimits/read') {
      const r = codexRateLimits(m === 'account/rateLimits/read' ? p : { rateLimits: p.rateLimits });
      if (r.windows.length) emit({ type: 'usage', provider: 'codex', ...r, replace: m === 'account/rateLimits/read' });
      return;
    }
    if (m === 'thread/started' && !core.mainThread) core.mainThread = p.thread?.id;
    // A subagent's own thread names it (nickname/role), even before its spawn call reports the thread id.
    if (m === 'thread/started' && p.thread?.parentThreadId && p.thread.id !== core.mainThread)
      threadLabel.set(
        p.thread.id,
        clip(
          p.thread.agentNickname || p.thread.agentRole || String(p.thread.preview || '').split('\n')[0] || 'subagente',
          120
        )
      );
    if (m === 'thread/started' && p.thread?.id === core.mainThread)
      emit({ type: 'session', sessionId: core.mainThread });
    if (tid && core.mainThread && tid !== core.mainThread) {
      // Work inside a subagent thread becomes live steps of its card.
      const owner = threadOwner.get(tid);
      if (!owner || !it || !/^item\/(started|completed)$/.test(m)) return;
      const s = codexItem(it, m === 'item/completed');
      if (s)
        subagent({
          toolUseId: owner,
          step: {
            id: it.id,
            kind: s.kind,
            label: s.label,
            detail: clip(s.detail, 300),
            status: s.status,
            ...(s.result ? { result: s.result } : {}),
          },
        });
      return;
    }
    if (m === 'item/started' && it?.type === 'agentMessage') core.paragraph = true;
    if (m === 'item/agentMessage/delta') {
      streamed.add(p.itemId);
      if (core.paragraph && core.text) append('\n\n');
      core.paragraph = false;
      append(p.delta);
    }
    if (m === 'item/completed' && it?.type === 'agentMessage' && !streamed.has(it.id) && it.text) {
      append((core.text ? '\n\n' : '') + it.text);
      core.paragraph = false;
    }
    if ((m === 'item/started' || m === 'item/completed') && it) {
      const done = m === 'item/completed';
      if (it.type === 'subAgentActivity' && it.agentThreadId) {
        // Newer Codex announces each subagent by its thread and path ("/root/criar_pasta"): the card is keyed by that thread.
        const key = it.agentThreadId,
          name =
            String(it.agentPath || '')
              .split('/')
              .filter(Boolean)
              .pop() || 'subagente';
        threadOwner.set(key, key);
        if (!threadLabel.has(key)) threadLabel.set(key, clip(name.replace(/_/g, ' '), 120));
        if (it.kind === 'started' && !subs.has(key))
          startSub(key, { subagent_type: 'agent', description: threadLabel.get(key) }, 'running');
        if (it.kind === 'completed' && subs.has(key)) subagent({ toolUseId: key, status: 'done' });
        if (['failed', 'errored', 'interrupted'].includes(it.kind) && subs.has(key))
          subagent({ toolUseId: key, status: taskStatus(it.kind) });
      } else if (it.type === 'collabAgentToolCall') {
        if (it.tool === 'spawnAgent') {
          for (const t of it.receiverThreadIds || []) threadOwner.set(t, it.id);
          if (!subs.has(it.id))
            startSub(
              it.id,
              {
                subagent_type: 'agent',
                prompt: it.prompt || '',
                description: String(it.prompt || '').split('\n')[0],
              },
              'running'
            );
        }
        // Any collab call carries the states of the agents it touched: finished ones close their card.
        for (const [t, st] of Object.entries(it.agentsStates || {})) {
          const owner = threadOwner.get(t);
          if (owner && ['completed', 'errored', 'shutdown', 'interrupted', 'notFound'].includes(st?.status))
            subagent({
              toolUseId: owner,
              status: taskStatus(st.status),
              ...(st.message ? { result: clip(st.message, 4000) } : {}),
            });
        }
      } else {
        if (m === 'item/started' && it.type === 'mcpToolCall' && it.server === MEMORY_SERVER)
          memoryCall(MEMORY_SERVER + '_' + it.tool, it.arguments);
        const s = codexItem(it, done);
        if (s)
          activity(s.label, s.detail, {
            kind: s.kind,
            id: it.id,
            status: s.status,
            ...(s.result ? { result: s.result } : {}),
          });
      }
    }
    if (m === 'thread/tokenUsage/updated' && tid === core.mainThread) {
      const l = p.tokenUsage?.last || {};
      usage.inputTokens += num(l.inputTokens);
      usage.outputTokens += num(l.outputTokens) + num(l.reasoningOutputTokens);
      usage.cacheTokens += num(l.cachedInputTokens);
    }
    if (m === 'turn/completed' && tid === core.mainThread) {
      if (usage.inputTokens || usage.outputTokens) cost(usage);
      if (p.turn?.status === 'failed')
        emit({ type: 'provider-error', message: p.turn.error?.message || 'O Codex não concluiu a resposta' });
    }
    if (m === 'error' && !p.willRetry && (!tid || tid === core.mainThread))
      emit({ type: 'provider-error', message: p.error?.message || 'Falha no Codex' });
  };
}
module.exports = { codexHandler, codexItem };
