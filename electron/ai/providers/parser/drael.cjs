// Drael's stream (text / tool / result / end) -> parser events.
const { clip } = require('../../../util/text.cjs');
const { toolKind } = require('../tool-display.cjs');

function draelHandler(core) {
  const { emit, append, startSub, subagent, activity, activityUpdate, cost } = core;
  let draelToolId = 0;
  const draelTools = new Map();
  return function accept(event) {
    if (event.type === 'text') append(event.text);
    if (event.type === 'tool') {
      const id = 'drael-' + ++draelToolId,
        queue = draelTools.get(event.name) || [];
      queue.push(id);
      draelTools.set(event.name, queue);
      if (event.name === 'task') startSub(id, event.args, 'running');
      else
        activity(event.name, JSON.stringify(event.args || {}), {
          kind: toolKind(event.name),
          status: 'running',
          toolUseId: id,
          id,
        });
    }
    if (event.type === 'result') {
      const id = draelTools.get(event.name)?.shift() || 'drael-' + ++draelToolId,
        status = event.error ? 'error' : 'done';
      if (event.name === 'task') subagent({ toolUseId: id, status, result: clip(event.text, 12000) });
      else activityUpdate(id, { status, kind: toolKind(event.name), result: clip(event.text, 600) });
    }
    if (event.type === 'end') {
      cost({
        inputTokens: event.usage?.input,
        outputTokens: event.usage?.output,
        cacheTokens: event.usage?.cached,
      });
      if (event.refused || event.stopped === 'max_turns')
        emit({
          type: 'provider-error',
          message: event.refused || 'Drael atingiu o limite de etapas desta resposta.',
        });
    }
  };
}
module.exports = { draelHandler };
