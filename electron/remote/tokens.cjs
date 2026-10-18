// Pairing codes (single use, short-lived) and device tokens (long-lived, only their SHA-256 is stored).
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');

const CODE_BYTES = 18; // 144 bits
const TOKEN_BYTES = 32; // 256 bits
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_OPEN_CODES = 5;
const MAX_DEVICES = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_TTL_MS = 30 * DAY_MS; // no access for 30 days -> the device must pair again
const ABSOLUTE_TTL_MS = 180 * DAY_MS; // 180 days after pairing -> the device must pair again, active or not

const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
const newCode = () => randomBytes(CODE_BYTES).toString('base64url');
const newToken = () => randomBytes(TOKEN_BYTES).toString('base64url');
// Both inputs are hex digests of the same length, so the comparison never short-circuits on content.
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex'),
    y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
const cleanName = (name) =>
  String(name || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 40) || 'Celular';

// Pairing codes live only in memory (hashed). redeem() consumes the code whether it is valid or not expired.
class Pairing {
  constructor({ now = Date.now, ttlMs = CODE_TTL_MS } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.open = new Map(); // sha256(code) -> expiresAt
  }
  sweep() {
    const t = this.now();
    for (const [h, exp] of this.open) if (exp <= t) this.open.delete(h);
  }
  create() {
    this.sweep();
    while (this.open.size >= MAX_OPEN_CODES) this.open.delete(this.open.keys().next().value);
    const code = newCode(),
      expiresAt = this.now() + this.ttlMs;
    this.open.set(hashToken(code), expiresAt);
    return { code, expiresAt };
  }
  redeem(code) {
    this.sweep();
    const h = hashToken(code);
    let found = false;
    // Walk every open code so the time taken does not depend on which one matched.
    for (const known of this.open.keys()) if (safeEqualHex(known, h)) found = true;
    if (found) this.open.delete(h);
    return found;
  }
  clear() {
    this.open.clear();
  }
  get size() {
    this.sweep();
    return this.open.size;
  }
}

// The list of paired devices lives in the store (`remote.devices`): { id, name, tokenHash, createdAt, lastSeenAt }.
// A device expires after IDLE_TTL_MS without use or ABSOLUTE_TTL_MS after pairing; every authenticated use renews lastSeenAt.
class Devices {
  constructor({ list, save, now = Date.now, idleMs = IDLE_TTL_MS, absoluteMs = ABSOLUTE_TTL_MS }) {
    this.list = list; // () => mutable array
    this.save = save;
    this.now = now;
    this.idleMs = idleMs;
    this.absoluteMs = absoluteMs;
    this.lastSave = 0;
  }
  isExpired(d) {
    const t = this.now();
    return t - d.lastSeenAt > this.idleMs || t - d.createdAt > this.absoluteMs;
  }
  add(name) {
    // Expired devices can never authenticate again: they must not take up a slot.
    const devices = this.list();
    for (let i = devices.length - 1; i >= 0; i--) if (this.isExpired(devices[i])) devices.splice(i, 1);
    if (devices.length >= MAX_DEVICES) throw new Error('Limite de aparelhos atingido. Revogue algum no desktop.');
    const token = newToken(),
      t = this.now();
    const device = {
      id: randomUUID(),
      name: cleanName(name),
      tokenHash: hashToken(token),
      createdAt: t,
      lastSeenAt: t,
    };
    devices.push(device);
    this.save();
    return { device: publicDevice(device), token };
  }
  // -> { device, expired }: the stored device for a token (expired or not), or device null. No early exit.
  inspect(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return { device: null, expired: false };
    const h = hashToken(token);
    let match = null;
    for (const d of this.list()) if (safeEqualHex(d.tokenHash, h)) match = d;
    return { device: match, expired: !!match && this.isExpired(match) };
  }
  // The device for a token, or null when unknown or expired.
  authenticate(token) {
    const { device, expired } = this.inspect(token);
    return expired ? null : device;
  }
  get(id) {
    return this.list().find((d) => d.id === id) || null;
  }
  touch(device) {
    const t = this.now();
    device.lastSeenAt = t;
    if (t - this.lastSave > 60_000) {
      this.lastSave = t;
      this.save();
    }
  }
  rename(id, name) {
    const d = this.list().find((x) => x.id === id);
    if (!d) return false;
    d.name = cleanName(name);
    this.save();
    return true;
  }
  revoke(id) {
    const devices = this.list(),
      i = devices.findIndex((x) => x.id === id);
    if (i < 0) return false;
    devices.splice(i, 1);
    this.save();
    return true;
  }
  view() {
    return this.list().map((d) => ({ ...publicDevice(d), expired: this.isExpired(d) }));
  }
}
const publicDevice = ({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, lastSeenAt });

module.exports = {
  Pairing,
  Devices,
  hashToken,
  newCode,
  newToken,
  safeEqualHex,
  cleanName,
  publicDevice,
  CODE_TTL_MS,
  MAX_DEVICES,
  IDLE_TTL_MS,
  ABSOLUTE_TTL_MS,
};
