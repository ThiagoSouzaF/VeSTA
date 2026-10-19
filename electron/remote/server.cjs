// HTTP + WebSocket server of the remote control. No framework: a handful of routes, all explicit.
//   GET  /...          static mobile app (public: it holds no data)
//   POST /api/pair     { code, name } -> { token, device }          (single-use pairing code)
//   POST /api/call     { method, args }                              (Bearer token, allowlisted methods only)
//   WS   /ws           first message { t:'auth', token }             (never a token in the URL)
const http = require('node:http');
const fs = require('node:fs'),
  path = require('node:path'),
  zlib = require('node:zlib');
const { WebSocketServer } = require('ws');
const { isIP } = require('node:net');
const { hostAllowed } = require('./net.cjs');
const { cleanName } = require('./tokens.cjs');
const { validateArgs, isAllowed, RemoteError } = require('./allowlist.cjs');
const { isUserError } = require('../errors.cjs');
const { createLimiter } = require('./limiter.cjs');
const { createConnectionGate, normalizeIp, isLoopback } = require('./connections.cjs');

const MAX_BODY = 256 * 1024;
const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 20_000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg']);
const GENERIC_ERROR = 'Não foi possível concluir a operação. Veja o registro do VeSTA no desktop.';
const PAIRING_BUSY = 'Já existe um pareamento aguardando confirmação no desktop. Tente de novo em instantes.';
const EXPIRED_MESSAGE = 'Este aparelho expirou por falta de uso. Pareie de novo no desktop.';

// confirmPairing({ name, ip }) -> 'yes' | 'no' | 'timeout' | 'busy' (the native dialog on the desktop). Without it nothing pairs.
function createRemoteServer({
  devices,
  pairing,
  hub,
  dispatch,
  staticRoot,
  pairLimiter,
  authLimiter,
  deviceLimiter,
  gate,
  confirmPairing = async () => 'no',
  onActivity,
  log = (...args) => console.error('[remote]', ...args),
}) {
  pairLimiter ||= createLimiter({ max: 6, windowMs: 60_000, blockMs: 5 * 60_000 });
  authLimiter ||= createLimiter({ max: 10, windowMs: 60_000, blockMs: 5 * 60_000 });
  // Per device (valid token): a runaway or stolen-token client is slowed down, a normal phone never gets near this.
  deviceLimiter ||= createLimiter({ max: 600, windowMs: 60_000, blockMs: 30_000 });
  gate ||= createConnectionGate();
  let pairingPending = false; // one pairing waits for the desktop dialog at a time
  const servers = [];
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  let heartbeat = null;
  const fileCache = new Map(); // file -> { mtimeMs, raw, gz }

  function securityHeaders(host, extra = {}) {
    const ws = hostAllowed(host) ? ' ws://' + host + ' wss://' + host : '';
    return {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
        "connect-src 'self'" +
        ws +
        "; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      ...extra,
    };
  }
  function send(req, res, status, body, headers = {}) {
    res.writeHead(status, securityHeaders(req.headers.host, headers));
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  const json = (req, res, status, obj, headers = {}) =>
    send(req, res, status, JSON.stringify(obj), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
  const fail = (req, res, status, message, headers) => json(req, res, status, { error: message }, headers);

  // Same-origin only: no CORS headers are ever sent, and a request carrying a foreign Origin is refused.
  function originOk(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new RemoteError(413, 'Corpo da requisição grande demais'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(text ? JSON.parse(text) : {});
        } catch {
          reject(new RemoteError(400, 'JSON inválido'));
        }
      });
      req.on('error', reject);
    });
  }
  // Key of the rate limiters. Behind `tailscale serve` every request arrives from 127.0.0.1 with the real client in
  // X-Forwarded-For (the proxy appends it, so the last entry is the one it saw). That header is trusted ONLY when the
  // socket itself is loopback: a local process could forge it, which is acceptable because a local process already has
  // the whole PC. From any other address the header is ignored.
  function clientIp(req) {
    const ip = normalizeIp(req.socket.remoteAddress);
    if (!isLoopback(ip)) return ip;
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((x) => normalizeIp(x.trim()))
      .filter(Boolean);
    const last = forwarded.at(-1);
    return last && isIP(last) ? last : ip;
  }
  const bearer = (req) => {
    const m = /^Bearer\s+([\w-]{20,200})$/i.exec(req.headers.authorization || '');
    return m ? m[1] : '';
  };
  const retryHeaders = (ms) => ({ 'Retry-After': String(Math.ceil(ms / 1000)) });

  async function handlePair(req, res, ip) {
    const gateCheck = pairLimiter.check(ip);
    if (!gateCheck.allowed)
      return fail(req, res, 429, 'Muitas tentativas. Tente de novo mais tarde.', retryHeaders(gateCheck.retryAfterMs));
    // Checked before the code is spent, so a second phone does not burn its code while the desktop dialog is open.
    if (pairingPending) return fail(req, res, 429, PAIRING_BUSY);
    const body = await readBody(req);
    const code = typeof body.code === 'string' ? body.code.slice(0, 100) : '';
    if (!code || !pairing.redeem(code)) {
      pairLimiter.fail(ip);
      return fail(req, res, 401, 'Código inválido ou expirado. Gere outro no desktop.');
    }
    pairLimiter.reset(ip);
    if (pairingPending) return fail(req, res, 429, PAIRING_BUSY); // two requests that raced past the first check
    // The code alone is not enough: the person at the desktop has to approve this device in a native dialog.
    const name = cleanName(body.name);
    pairingPending = true;
    gate.hold(req.socket);
    let answer;
    try {
      answer = await confirmPairing({ name, ip });
    } finally {
      pairingPending = false;
      gate.release(req.socket);
    }
    if (answer === 'timeout')
      return fail(req, res, 408, 'O desktop não respondeu a tempo. Gere outro código e tente de novo.');
    if (answer !== 'yes') return fail(req, res, 403, 'O pareamento foi recusado no desktop.');
    const { device, token } = devices.add(name);
    onActivity?.('paired', device, { ip });
    json(req, res, 200, { token, device });
  }
  // Token first: a valid device is never held back by the failure limiter (an attacker on the same address, or behind the
  // same proxy, cannot lock the owner out). Only unknown tokens count as failures.
  async function handleCall(req, res, ip) {
    const { device, expired } = devices.inspect(bearer(req));
    if (!device || expired) {
      const gateCheck = authLimiter.check(ip);
      if (!gateCheck.allowed)
        return fail(
          req,
          res,
          429,
          'Muitas tentativas. Tente de novo mais tarde.',
          retryHeaders(gateCheck.retryAfterMs)
        );
      authLimiter.fail(ip);
      if (expired) return json(req, res, 401, { error: EXPIRED_MESSAGE, code: 'expired' });
      return fail(req, res, 401, 'Aparelho não autorizado');
    }
    const perDevice = deviceLimiter.check(device.id);
    if (!perDevice.allowed)
      return fail(
        req,
        res,
        429,
        'Muitas requisições deste aparelho. Aguarde um instante.',
        retryHeaders(perDevice.retryAfterMs)
      );
    deviceLimiter.fail(device.id);
    gate.authed(req.socket);
    devices.touch(device);
    onActivity?.('auth', device, { ip });
    const body = await readBody(req);
    const method = body && typeof body === 'object' ? body.method : undefined;
    if (!isAllowed(method)) return fail(req, res, 403, 'Operação não permitida no controle remoto');
    const args = validateArgs(method, body.args);
    const result = await dispatch(method, args, { device, ip });
    json(req, res, 200, { result: result === undefined ? null : result });
  }

  async function serveStatic(req, res, pathname) {
    if (!staticRoot || !fs.existsSync(staticRoot))
      return send(req, res, 503, 'App móvel não compilado. Rode npm run build.', {
        'Content-Type': 'text/plain; charset=utf-8',
      });
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return fail(req, res, 400, 'Caminho inválido');
    }
    if (rel.includes('\0') || rel.includes('\\')) return fail(req, res, 400, 'Caminho inválido');
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.resolve(staticRoot, '.' + rel);
    if (file !== path.resolve(staticRoot) && !file.startsWith(path.resolve(staticRoot) + path.sep))
      return fail(req, res, 403, 'Acesso negado');
    const ext = path.extname(file).toLowerCase();
    if (!MIME[ext]) return fail(req, res, 404, 'Não encontrado');
    let stat;
    try {
      stat = await fs.promises.stat(file);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      return fail(req, res, 404, 'Não encontrado');
    }
    let entry = fileCache.get(file);
    if (!entry || entry.mtimeMs !== stat.mtimeMs) {
      const raw = await fs.promises.readFile(file);
      entry = {
        mtimeMs: stat.mtimeMs,
        raw,
        gz: COMPRESSIBLE.has(ext) && raw.length > 1024 ? zlib.gzipSync(raw) : null,
      };
      fileCache.set(file, entry);
    }
    const hashed = rel.startsWith('/assets/');
    const headers = {
      'Content-Type': MIME[ext],
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      Vary: 'Accept-Encoding',
    };
    if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/';
    const gz = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gz) headers['Content-Encoding'] = 'gzip';
    send(req, res, 200, gz ? entry.gz : entry.raw, headers);
  }

  async function onRequest(req, res) {
    try {
      if (!hostAllowed(req.headers.host)) return fail(req, res, 421, 'Host não permitido');
      if (!originOk(req)) return fail(req, res, 403, 'Origem não permitida');
      const ip = clientIp(req);
      const { pathname } = new URL(req.url, 'http://x');
      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/health' && req.method === 'GET') return json(req, res, 200, { ok: true });
        if (req.method !== 'POST') return fail(req, res, 405, 'Método não suportado', { Allow: 'POST' });
        if (!/^application\/json\b/i.test(req.headers['content-type'] || ''))
          return fail(req, res, 415, 'Use application/json');
        if (pathname === '/api/pair') return await handlePair(req, res, ip);
        if (pathname === '/api/call') return await handleCall(req, res, ip);
        return fail(req, res, 404, 'Não encontrado');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return fail(req, res, 405, 'Método não suportado', { Allow: 'GET, HEAD' });
      await serveStatic(req, res, pathname);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e instanceof RemoteError) return fail(req, res, e.status, e.message);
      // Messages written for the person (UserError) are safe to show on the phone; the detail still goes to the log.
      if (isUserError(e)) {
        log('aviso em ' + req.method + ' ' + String(req.url).split('?')[0] + ':', e.message);
        return fail(req, res, 422, e.message);
      }
      // Anything unexpected: the detail stays in the local log, the client only gets a generic message.
      log('erro em ' + req.method + ' ' + String(req.url).split('?')[0] + ':', e?.stack || e);
      fail(req, res, 500, GENERIC_ERROR);
    }
  }

  // ---- WebSocket ---------------------------------------------------------------------------------------------------
  function onUpgrade(req, socket, head) {
    const deny = (code, text) => {
      socket.write('HTTP/1.1 ' + code + ' ' + text + '\r\nConnection: close\r\n\r\n');
      socket.destroy();
    };
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {}
    if (pathname !== '/ws') return deny(404, 'Not Found');
    if (!hostAllowed(req.headers.host)) return deny(421, 'Misdirected Request');
    if (!originOk(req)) return deny(403, 'Forbidden');
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, clientIp(req), socket));
  }
  function onSocket(ws, ip, socket) {
    let client = null,
      alive = true;
    const authTimer = setTimeout(() => ws.close(4401, 'auth timeout'), AUTH_TIMEOUT_MS);
    const reply = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
    ws.on('pong', () => (alive = true));
    ws.on('message', (raw) => {
      alive = true;
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return ws.close(4400, 'bad message');
      }
      if (client) return msg?.t === 'ping' ? reply({ t: 'hb', at: Date.now() }) : undefined;
      clearTimeout(authTimer);
      const { device, expired } =
        msg?.t === 'auth' && typeof msg.token === 'string' ? devices.inspect(msg.token) : { device: null };
      if (!device || expired) {
        // Like the HTTP side, only unknown or expired tokens are subject to (and counted by) the failure limiter.
        if (!authLimiter.check(ip).allowed) return ws.close(4429, 'rate limited');
        authLimiter.fail(ip);
        reply({ t: 'auth', ok: false, ...(expired ? { code: 'expired', error: EXPIRED_MESSAGE } : {}) });
        return ws.close(expired ? 4410 : 4401, expired ? 'expired' : 'unauthorized');
      }
      gate.authed(socket);
      ws._deviceId = device.id;
      devices.touch(device);
      onActivity?.('auth', device, { ip });
      client = {
        deviceId: device.id,
        ws,
        send: (text) => ws.readyState === ws.OPEN && ws.send(text),
        buffered: () => ws.bufferedAmount,
      };
      hub.add(client);
      reply({ t: 'ready', device: { id: device.id, name: device.name } });
      onActivity?.('connected', device, { ip });
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (client) hub.remove(client);
      client = null;
      onActivity?.('disconnected');
    });
    ws.on('error', (e) => (log('erro no WebSocket:', e?.message || e), ws.terminate()));
    ws._alive = () => alive;
    ws._setDead = () => (alive = false);
  }

  return {
    // Listens on every host; resolves once all are up, rejects (and closes the rest) if any fails.
    async listen(hosts, port) {
      for (const host of hosts) {
        const server = http.createServer(onRequest);
        server.headersTimeout = 15_000;
        server.requestTimeout = 30_000;
        server.keepAliveTimeout = 10_000;
        // Connection budget (per-IP pre-auth cap, reserved room for authenticated devices, quick idle cut) lives in the gate.
        server.on('connection', (socket) => gate.accept(socket));
        server.on('upgrade', onUpgrade);
        try {
          await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => {
              server.off('error', reject);
              resolve();
            });
          });
        } catch (e) {
          await this.close();
          throw e;
        }
        // After the listen: a late error (socket-level, EMFILE...) is logged and never becomes an uncaught exception.
        server.on('error', (e) => log('erro no servidor:', e?.code || '', e?.message || e));
        servers.push(server);
        // The first server may have picked the port (port 0); the others reuse it.
        port = server.address().port;
      }
      heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
          if (ws._deviceId) {
            // A connection that stays open for months still obeys revocation and the expiry dates.
            const d = devices.get(ws._deviceId);
            if (!d) {
              ws.close(4403, 'revoked');
              continue;
            }
            if (devices.isExpired(d)) {
              ws.close(4410, 'expired');
              continue;
            }
            devices.touch(d);
          }
          if (!ws._alive?.()) ws.terminate();
          else {
            ws._setDead?.();
            ws.ping();
          }
        }
        hub.heartbeat();
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      return port;
    },
    async close() {
      clearInterval(heartbeat);
      heartbeat = null;
      for (const ws of wss.clients) ws.terminate();
      await Promise.all(
        servers.splice(0).map((s) => new Promise((resolve) => (s.closeAllConnections?.(), s.close(() => resolve()))))
      );
    },
    closeDevice(deviceId) {
      for (const c of hub.clientsOf(deviceId)) c.ws.close(4403, 'revoked');
    },
    limiters: { pair: pairLimiter, auth: authLimiter, device: deviceLimiter },
    gate,
    clientIp,
    get httpServers() {
      return [...servers];
    },
    get address() {
      return servers.map((s) => s.address());
    },
  };
}
module.exports = { createRemoteServer, MAX_BODY };
