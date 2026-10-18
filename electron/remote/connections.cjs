// Connection budget of the remote server. A connection is "pre-auth" until it proves a valid device token:
//   - each remote IP may hold only a few pre-auth connections (a flood from one address cannot starve the others);
//   - pre-auth connections are only a share of the total, so authenticated devices always have room left;
//   - idle pre-auth sockets are closed quickly (slowloris).
// Behind `tailscale serve` every socket comes from loopback, so the per-IP cap does not apply there (the shared pre-auth
// ceiling still does); the real client address is only known per request, from X-Forwarded-For.
const normalizeIp = (ip) => String(ip || '').replace(/^::ffff:/, '');
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1';

function createConnectionGate({ perIp = 8, preAuthMax = 120, totalMax = 200, idleMs = 10_000 } = {}) {
  const info = new WeakMap(); // socket -> { ip, authed }
  const byIp = new Map(); // ip -> pre-auth connections
  let total = 0,
    preAuth = 0;
  const leavePreAuth = (st) => {
    preAuth--;
    const n = (byIp.get(st.ip) || 1) - 1;
    if (n > 0) byIp.set(st.ip, n);
    else byIp.delete(st.ip);
  };
  return {
    // false (and the socket destroyed) when the budget is exhausted.
    accept(socket) {
      const ip = normalizeIp(socket.remoteAddress);
      if (total >= totalMax || preAuth >= preAuthMax || (!isLoopback(ip) && (byIp.get(ip) || 0) >= perIp)) {
        socket.destroy();
        return false;
      }
      const st = { ip, authed: false };
      info.set(socket, st);
      total++;
      preAuth++;
      byIp.set(ip, (byIp.get(ip) || 0) + 1);
      socket.setTimeout(idleMs);
      socket.on('timeout', () => !st.authed && socket.destroy());
      socket.once('close', () => {
        total--;
        if (!st.authed) leavePreAuth(st);
      });
      return true;
    },
    // The connection proved a valid token: it no longer counts against the pre-auth limits and is never cut as idle.
    authed(socket) {
      const st = info.get(socket);
      if (!st || st.authed) return;
      st.authed = true;
      leavePreAuth(st);
      socket.setTimeout(0);
    },
    // A request that legitimately waits for the desktop (pairing confirmation) must not be cut as idle.
    hold(socket) {
      socket.setTimeout(0);
    },
    release(socket) {
      if (info.get(socket) && !info.get(socket).authed) socket.setTimeout(idleMs);
    },
    get stats() {
      return { total, preAuth, byIp: Object.fromEntries(byIp) };
    },
  };
}
module.exports = { createConnectionGate, normalizeIp, isLoopback };
