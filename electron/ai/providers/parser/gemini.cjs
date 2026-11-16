// Gemini CLI over ACP: session/update payloads (plus the driver's own session / prompt_result / error markers) ->
// parser events. Tool calls become activity cards; the prompt's answer carries the token counts of the turn.
const { clip } = require('../../../util/text.cjs');
const { detailOf, toolKind, toolLabel, num } = require('../tool-display.cjs');

// ACP tool kinds -> the app's card kinds (an MCP tool keeps its own name, which says memory / quest / mcp).
const KIND = { read: 'file', edit: 'file', delete: 'file', move: 'file', search: 'search', execute: 'command' };
const STATUS = { pending: 'running', in_progress: 'running', completed: 'done', failed: 'error' };
// The text of a tool call's content blocks (ACP: { type: 'content', content: { type: 'text', text } } or diffs).
const contentText = (content) =>
  (Array.isArray(content) ? content : [])
    .map((c) =>
      c?.type === 'diff' ? 'Alterou ' + (c.path || 'um arquivo') : c?.content?.type === 'text' ? c.content.text : ''
    )
    .filter(Boolean)
    .join('\n');
// The tool's own name: MCP tools come as "<tool> (<server> MCP Server)" in the title.
const mcpName = (title) => {
  const m = /^([\w.-]+) \(([\w.-]+) MCP Server\)/.exec(String(title || ''));
  return m ? 'mcp_' + m[2] + '_' + m[1] : '';
};

function geminiHandler(core) {
  const { emit, append, activity, activityUpdate, cost, memoryCall } = core;
  const calls = new Map(); // toolCallId -> name used for the card
  return function accept(u) {
    switch (u.sessionUpdate) {
      case 'session':
        if (u.sessionId) emit({ type: 'session', sessionId: u.sessionId });
        return;
      case 'agent_message_chunk':
        if (u.content?.type === 'text') append(u.content.text || '');
        return;
      case 'tool_call': {
        const input = u.rawInput || {};
        const name = mcpName(u.title);
        calls.set(u.toolCallId, name);
        if (name) memoryCall(name, input, u.toolCallId);
        const status = STATUS[u.status] || 'running';
        activity(name ? toolLabel(name) : clip(u.title || 'Usando uma ferramenta', 200), detailOf(input), {
          kind: name ? toolKind(name) : KIND[u.kind] || 'tool',
          id: u.toolCallId || undefined,
          status,
          ...(status !== 'running' ? { result: clip(contentText(u.content), 600) } : {}),
        });
        return;
      }
      case 'tool_call_update': {
        if (!u.toolCallId) return;
        const status = STATUS[u.status];
        const result = contentText(u.content);
        activityUpdate(u.toolCallId, {
          ...(status ? { status } : {}),
          ...(result ? { result: clip(result, 600) } : {}),
        });
        return;
      }
      case 'prompt_result': {
        const t = u.usage || {};
        cost({
          inputTokens: t.inputTokens,
          outputTokens: num(t.outputTokens) + num(t.thoughtTokens),
          cacheTokens: t.cachedReadTokens,
          costUsd: 0,
        });
        if (u.stopReason === 'refusal') emit({ type: 'provider-error', message: 'O Gemini recusou a resposta.' });
        if (u.stopReason === 'max_turn_requests' || u.stopReason === 'max_tokens')
          emit({ type: 'provider-error', message: 'O Gemini parou no limite da conversa (' + u.stopReason + ').' });
        return;
      }
      case 'error':
        emit({ type: 'provider-error', message: u.message || 'Falha no Gemini' });
        return;
    }
  };
}
module.exports = { geminiHandler, mcpName };
