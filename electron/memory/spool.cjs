// The hook spool: lifecycle events queued on disk while no server answered, and pointing them at the current server.
const fs = require('node:fs');
const path = require('node:path');
const { writeAtomic } = require('../util/sys.cjs');
const spoolDir = (dir) => path.join(dir, 'hook-spool');
const spoolFiles = (dir) => {
  try {
    return fs.readdirSync(spoolDir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
};
const spoolCount = (dir) => spoolFiles(dir).length;
// Every queued event stores `url` (absolute, with the port of the server that was current when it was queued).
// Loopback events are pointed at the current server (and its token: an event queued with the token of an older run, or
// with none, would be refused); anything else is left alone. Returns how many files changed.
function retargetSpool(dir, currentUrl, token) {
  let changed = 0;
  const target = new URL(currentUrl);
  for (const name of spoolFiles(dir)) {
    const file = path.join(spoolDir(dir), name);
    try {
      const item = JSON.parse(fs.readFileSync(file, 'utf8'));
      const u = new URL(item.url);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) continue;
      const auth = token && (item.auth_mode !== 'static' || item.token !== token);
      if (u.origin === target.origin && !auth) continue;
      item.url = target.origin + u.pathname + u.search;
      if (token) Object.assign(item, { auth_mode: 'static', token });
      writeAtomic(file, JSON.stringify(item));
      changed++;
    } catch {}
  }
  return changed;
}
module.exports = { spoolCount, retargetSpool };
