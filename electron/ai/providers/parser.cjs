// parser(provider, emit): turns one CLI's event stream into the app's events (text, activities, subagents, cost...).
// The shared state lives in parser/core.cjs; each provider has its own handler in parser/.
const { createCore } = require('./parser/core.cjs');
const { claudeHandler } = require('./parser/claude.cjs');
const { codexHandler } = require('./parser/codex.cjs');
const { opencodeHandler } = require('./parser/opencode.cjs');
const { draelHandler } = require('./parser/drael.cjs');

function parser(provider, emit) {
  const core = createCore(provider, emit);
  const accept = (
    provider === 'drael'
      ? draelHandler
      : provider === 'codex'
        ? codexHandler
        : provider === 'claude'
          ? claudeHandler
          : opencodeHandler
  )(core);
  return {
    get text() {
      return core.text;
    },
    setMainThread(id) {
      core.mainThread = id;
    },
    // Claude background subagents still working: their completion starts another turn in the same process.
    backgroundRunning() {
      return core.background.size > 0;
    },
    // Background commands / monitors the CLI still tracks (not subagents): the reason to keep following a chat.
    followTasks() {
      return core.listTasks();
    },
    // A new turn of the same process (a background task finished, or the user wrote again): the text restarts.
    nextTurn() {
      core.text = '';
      core.gap = false;
      core.paragraph = false;
    },
    ownerOf(toolUseId) {
      const id = core.toolOwner.get(toolUseId);
      return id ? core.subLabels.get(id) || 'subagente' : null;
    },
    ownerOfThread(threadId) {
      if (!threadId || threadId === core.mainThread) return null;
      const id = core.threadOwner.get(threadId);
      return core.threadLabel.get(threadId) || (id && core.subLabels.get(id)) || 'subagente';
    },
    accept,
  };
}
module.exports = { parser };
