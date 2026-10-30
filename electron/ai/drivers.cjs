// One turn of a chat against its CLI. Each driver (drivers/) feeds the provider parser and routes the agent's permission
// requests (its own and its subagents') through ctx.ask, which waits for the user's answer.
// start(provider, spec, ctx) -> {done: Promise<{code, stderr, finished}>, stop()}
//   spec: providers.command(); ctx: {cwd, env, prompt, parse, ask(request) -> Promise<{allow, message}>, version,
//   attachments, follow, onFollow, onAutoTurn, onTasks, lingerMs}
// `start` stays a property of the exports object: tests and E2E scripts replace it, and callers go through it.
const drael = require('./drael.cjs');
const { runClaude, claudeDetail } = require('./drivers/claude.cjs');
const { runCodex } = require('./drivers/codex.cjs');
const { runOpenCode } = require('./drivers/opencode.cjs');
const { lines, json } = require('./drivers/ndjson.cjs');

function start(provider, spec, ctx) {
  return provider === 'drael'
    ? drael.start(spec, ctx)
    : provider === 'claude'
      ? runClaude(spec, ctx)
      : provider === 'codex'
        ? runCodex(spec, ctx)
        : runOpenCode(spec, ctx);
}
module.exports = { start, claudeDetail, lines, json };
