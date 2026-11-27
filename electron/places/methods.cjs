// IPC surface of Onde rodam: thin wrappers over the places engine (created once the store is ready). Each change
// answers with the places as they are now and the state, so the screen redraws from one reply.
function placeMethods(ctx) {
  const done = (fn) => async (args) => ({
    ...((await fn(args || {})) || {}),
    ...ctx.places.view(),
    state: ctx.state(),
  });
  return {
    placesView: async () => {
      await ctx.places.sync();
      return { ...ctx.places.view(), state: ctx.state() };
    },
    placeInstall: done((a) => ctx.places.install(a)),
    placeUpdate: done((a) => ctx.places.update(a)),
    placeRemove: done((a) => ctx.places.remove(a)),
    placeRun: done((a) => ctx.places.runNow(a)),
    placeRunner: done((a) => ctx.places.updateRunner(a)),
    placeConnect: done((a) => ctx.places.connect(a)),
    placeRefresh: done((a) => ctx.places.refresh(a)),
    placeForget: done((a) => ctx.places.forgetPlace(a)),
    placeRuns: (args) => ctx.places.runs(args || {}),
    placeOpen: () => ctx.shell?.openPath(ctx.places.home),
  };
}
module.exports = { placeMethods };
