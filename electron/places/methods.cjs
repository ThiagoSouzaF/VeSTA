// IPC surface of Onde rodam: thin wrappers over the places engine (created once the store is ready).
function placeMethods(ctx) {
  const done = (fn) => async (args) => ({
    ...((await fn(args || {})) || {}),
    ...ctx.places.view(),
    state: ctx.state(),
  });
  return {
    placesView: () => {
      ctx.places.sync();
      return { ...ctx.places.view(), state: ctx.state() };
    },
    placeInstall: done((a) => ctx.places.install(a)),
    placeUpdate: done((a) => ctx.places.update(a)),
    placeRemove: done((a) => ctx.places.remove(a)),
    placeRun: done((a) => ctx.places.runNow(a)),
    placeRunner: done(() => ctx.places.updateRunner()),
    placeRuns: (args) => ctx.places.runs(args || {}),
    placeOpen: () => ctx.shell?.openPath(ctx.places.home),
  };
}
module.exports = { placeMethods };
