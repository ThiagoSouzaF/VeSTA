// Process, port, time and file helpers shared by the main process.
const fs = require('node:fs'),
  net = require('node:net'),
  path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A free TCP port on loopback.
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
// Can this port be bound on loopback right now?
const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.on('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });

// Writes beside and renames, so a reader (or a sync client like Drive/OneDrive) never sees half a file.
function writeAtomic(file, data, { suffix = '.tmp' } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + suffix, data, typeof data === 'string' ? 'utf8' : undefined);
  fs.renameSync(file + suffix, file);
}

module.exports = { sleep, freePort, portFree, writeAtomic };
