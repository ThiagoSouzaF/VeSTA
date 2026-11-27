// IPC surface of Agent Mode: thin wrappers over the engine (created once the store is ready).
function agentMethods(ctx) {
  // A change of the agent may leave its install in a place outdated (places/engine.cjs).
  const done = (fn) => (args) => {
    fn(args || {});
    ctx.places?.sync();
    return ctx.state();
  };
  return {
    agentCreate: (args) => ({ id: ctx.agents.create(args || {}), state: ctx.state() }),
    agentUpdate: done((a) => ctx.agents.update(a)),
    agentToggle: done((a) => ctx.agents.toggle(a)),
    agentRemove: done((a) => ctx.agents.remove(a)),
    agentSeen: done(() => ctx.agents.seen()),
    agentLesson: done((a) => ctx.agents.lesson(a)),
    agentSuggestion: done((a) => ctx.agents.suggestion(a)),
    // The screen also needs the chat of the run, to open it.
    agentRun: (args) => ({ ...ctx.agents.runNow(args || {}), state: ctx.state() }),
  };
}
module.exports = { agentMethods };
