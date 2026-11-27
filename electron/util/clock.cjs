// The repeating job of an engine: `first` runs at start, then `tick` every `ms`. The env var only shortens the interval
// for the E2E tests; deps.setInterval/clearInterval let unit tests drive it.
function clock(tick, { ms, env, first, deps = {} }) {
  let timer = null;
  return {
    startClock() {
      first?.();
      timer = (deps.setInterval || setInterval)(tick, Number(process.env[env]) || ms);
      timer?.unref?.();
    },
    stopClock() {
      if (timer) (deps.clearInterval || clearInterval)(timer);
      timer = null;
    },
  };
}

module.exports = { clock };
