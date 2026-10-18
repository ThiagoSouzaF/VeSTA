// Where the remote server may listen. Nothing here ever returns 0.0.0.0, and there is no plain-HTTP LAN mode.
const os = require('node:os');

const BINDS = ['tailscale', 'localhost'];
const LOOPBACK = '127.0.0.1';
const DEFAULT_PORT = 47900;

const octets = (ip) => String(ip).split('.').map(Number);
// 100.64.0.0/10 (Tailscale's CGNAT range). On its own this is NOT proof of Tailscale: WSL, Docker and carrier-grade NAT
// use the same range, so it is only ever combined with a trusted source (the CLI, or an interface named "Tailscale").
function isTailscaleIp(ip) {
  const o = octets(ip);
  return (
    o.length === 4 &&
    o.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    o[0] === 100 &&
    o[1] >= 64 &&
    o[1] <= 127
  );
}
const TAILSCALE_IFACE = /tailscale/i;
// The Tailscale IPv4 address of this computer, or null. Trusted sources only, in this order:
//   1. the CLI (`tailscale status --json` / `tailscale ip -4`): `cli` = { installed, running, ips };
//      when the CLI exists its answer is final (stopped or logged out = no address);
//   2. without a CLI, an interface whose NAME says Tailscale and whose IPv4 is in 100.64.0.0/10.
// `interfaces` is os.networkInterfaces() (injectable for tests).
function detectAddresses(interfaces = os.networkInterfaces(), cli = null) {
  if (cli?.installed) {
    const ip = cli.running ? (cli.ips || []).find((x) => isTailscaleIp(x)) : null;
    return { tailscale: ip || null };
  }
  for (const [name, list] of Object.entries(interfaces || {})) {
    if (!TAILSCALE_IFACE.test(name)) continue;
    for (const a of list || [])
      if (a.family === 'IPv4' && !a.internal && isTailscaleIp(a.address)) return { tailscale: a.address };
  }
  return { tailscale: null };
}
const defaultBind = (addresses) => (addresses.tailscale ? 'tailscale' : 'localhost');

// -> { hosts: [addresses to listen on], primary: host shown in the pairing URL } or { error }
// "tailscale" also listens on loopback (local only) so `tailscale serve` and the desktop tests can reach it.
function resolveBind(bind, addresses) {
  if (bind === 'tailscale') {
    if (!addresses.tailscale)
      return {
        error:
          'Tailscale não detectado neste computador. Instale e entre na sua conta, ou escolha "Somente este computador".',
      };
    return { hosts: [addresses.tailscale, LOOPBACK], primary: addresses.tailscale };
  }
  if (bind === 'localhost') return { hosts: [LOOPBACK], primary: LOOPBACK };
  return { error: 'Interface inválida' };
}
// Host header guard against DNS rebinding: only IP literals, localhost and Tailscale MagicDNS names are served.
function hostAllowed(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader || hostHeader.length > 255) return false;
  const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
  if (host === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (/^\[[0-9a-f:]+\]$/.test(host)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(host);
}
const validPort = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;

module.exports = {
  BINDS,
  LOOPBACK,
  DEFAULT_PORT,
  isTailscaleIp,
  detectAddresses,
  defaultBind,
  resolveBind,
  hostAllowed,
  validPort,
};
