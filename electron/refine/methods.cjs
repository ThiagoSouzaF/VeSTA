// IPC surface of refining (skills and agents): thin wrappers over refine/engine.cjs. Changes answer with the new state.
function refineMethods(ctx) {
  const R = () => ctx.refiner;
  const withState = (fn) => async (args) => {
    const result = await fn(args || {});
    return { result, state: ctx.state() };
  };
  return {
    refineStart: withState((a) => R().start(a)),
    refineProposal: (a) => R().proposal(a || {}),
    refineApply: withState((a) => R().apply(a)),
    refineDiscard: withState((a) => R().discard(a)),
    refineRestore: withState((a) => R().restore(a)),
    refineVersion: (a) => R().version(a || {}),
  };
}
module.exports = { refineMethods };
