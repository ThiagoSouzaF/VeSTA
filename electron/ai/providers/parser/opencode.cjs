// OpenCode events (the shapes `opencode run --format json` prints) -> parser events.
const { clip } = require('../../../util/text.cjs');
const { toolKind, toolLabel, textOf, summarize, num } = require('../tool-display.cjs');

function opencodeHandler(core) {
  const { emit, append, startSub, activity, cost, memoryCall } = core;
  const seen = new Set();
  return function accept(event) {
    const sessionId = event.sessionID || event.part?.sessionID;
    if (sessionId) emit({ type: 'session', sessionId });
    if (event.type === 'text') {
      const key = event.part?.id;
      if (!key || !seen.has(key)) {
        if (key) seen.add(key);
        append((core.text ? '\n\n' : '') + (event.part?.text || event.text || ''));
      }
    }
    if (event.type === 'tool_use') {
      const part = event.part || {},
        st = part.state || {},
        id = part.callID || part.id || '';
      if (part.tool === 'task') {
        const status = st.status === 'error' ? 'error' : st.status === 'completed' ? 'done' : 'running';
        startSub(
          id,
          st.input || {},
          status,
          status === 'running' ? undefined : summarize(st.output || st.error || st.title)
        );
      } else {
        memoryCall(part.tool, st.input, id);
        activity(
          toolLabel(part.tool),
          st.title ||
            st.input?.query ||
            st.input?.path ||
            st.input?.command ||
            st.input?.filePath ||
            st.input?.pattern ||
            '',
          {
            kind: toolKind(part.tool),
            id: id || undefined,
            status: st.status === 'completed' ? 'done' : st.status === 'error' ? 'error' : 'running',
            ...(st.status === 'completed' || st.status === 'error'
              ? { result: clip(textOf(st.output || st.error), 600) }
              : {}),
          }
        );
      }
    }
    if (event.type === 'step_finish' && event.part) {
      const t = event.part.tokens || {};
      cost({
        inputTokens: t.input,
        outputTokens: num(t.output) + num(t.reasoning),
        cacheTokens: num(t.cache?.read) + num(t.cache?.write),
        costUsd: event.part.cost,
      });
    }
    if (event.type === 'error')
      emit({
        type: 'provider-error',
        message: event.error?.data?.message || event.error?.message || 'Falha no OpenCode',
      });
  };
}
module.exports = { opencodeHandler };
