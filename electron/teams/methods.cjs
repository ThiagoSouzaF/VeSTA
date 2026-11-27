// IPC surface of Equipes: thin wrappers over the team engine (created once the store is ready).
function teamMethods(ctx) {
  const done = (fn) => async (args) => {
    await fn(args || {});
    return ctx.state();
  };
  return {
    teamCreate: (args) => ({ id: ctx.teams.create(args || {}), state: ctx.state() }),
    teamUpdate: done((a) => ctx.teams.update(a)),
    teamPlace: done((a) => ctx.teams.place(a)),
    teamRemove: done((a) => ctx.teams.remove(a)),
    teamStart: done((a) => ctx.teams.start(a)),
    teamPause: done((a) => ctx.teams.pause(a)),
    teamStop: done((a) => ctx.teams.stopAll(a)),
    teamAnswer: done((a) => ctx.teams.answer(a)),
    teamSay: done((a) => ctx.teams.say(a)),
    teamMerge: async (args) => ({ ...(await ctx.teams.merge(args || {})), state: ctx.state() }),
    teamBranches: (args) => ctx.teams.branches(args || {}),
  };
}
module.exports = { teamMethods };
