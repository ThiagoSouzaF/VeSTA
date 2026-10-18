// Per-IP attempt limiter: too many failures inside a window block that IP for a while.
// `now` is injectable so the tests do not have to wait.
function createLimiter({ max = 8, windowMs = 60_000, blockMs = 300_000, maxEntries = 2000, now = Date.now } = {}) {
  const entries = new Map(); // ip -> { fails: number[], blockedUntil }
  const prune = () => {
    const t = now();
    for (const [ip, e] of entries) {
      e.fails = e.fails.filter((x) => t - x < windowMs);
      if (!e.fails.length && e.blockedUntil <= t) entries.delete(ip);
    }
    // Under a flood of distinct addresses keep memory bounded: forget the oldest ones.
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  };
  return {
    // { allowed, retryAfterMs }
    check(ip) {
      const e = entries.get(ip),
        t = now();
      if (e && e.blockedUntil > t) return { allowed: false, retryAfterMs: e.blockedUntil - t };
      return { allowed: true, retryAfterMs: 0 };
    },
    fail(ip) {
      const t = now();
      if (entries.size >= maxEntries) prune();
      const e = entries.get(ip) || { fails: [], blockedUntil: 0 };
      e.fails = e.fails.filter((x) => t - x < windowMs);
      e.fails.push(t);
      if (e.fails.length >= max) {
        e.blockedUntil = t + blockMs;
        e.fails = [];
      }
      entries.set(ip, e);
    },
    reset(ip) {
      entries.delete(ip);
    },
    prune,
    get size() {
      return entries.size;
    },
  };
}
module.exports = { createLimiter };
