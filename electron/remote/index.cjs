// Remote control of VeSTA from a phone. Off by default. This file wires the pieces and owns the lifecycle:
//   config (store.remote) -> server (HTTP/WS) -> hub (events) ; dispatch() maps allowlisted calls to the desktop methods.
const path = require('node:path'),
  os = require('node:os'),
  { createHash } = require('node:crypto');
const { Pairing, Devices } = require('./tokens.cjs');
const { createHub } = require('./hub.cjs');
const { createRemoteServer } = require('./server.cjs');
const { RemoteError } = require('./allowlist.cjs');
const { sanitizeState, sanitizeChat, sanitizeIntegrations, createStateDiffer } = require('./sanitize.cjs');
const net = require('./net.cjs');
const tailscale = require('./tailscale.cjs');
const { redact } = require('../memory.cjs');

const MODES = ['edit', 'read', 'ask'];
const SESSION_GAP_MS = 15 * 60 * 1000; // a device idle for this long is "a new session" for the desktop notice
const LAN_REMOVED =
  'O modo "Rede local (LAN)" foi removido: era HTTP sem criptografia. O controle remoto foi desligado; para usar o celular, instale o Tailscale e escolha "Somente Tailscale".';

// notice: one-time message for the Preferências screen (cleared by the next change the user makes).
// serveOwnedPort: the port VeSTA itself published with `tailscale serve` (the only publication it may undo).
const defaultRemote = () => ({
  enabled: false,
  bind: null,
  port: net.DEFAULT_PORT,
  devices: [],
  notice: '',
  serveOwnedPort: null,
});
// Store migration: whatever is saved becomes a well-formed config.
function normalizeRemote(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const lan = r.bind === 'lan'; // the LAN (plain HTTP) mode no longer exists: off, with a warning
  return {
    enabled: lan ? false : r.enabled === true,
    notice: lan ? LAN_REMOVED : typeof r.notice === 'string' ? r.notice.slice(0, 400) : '',
    serveOwnedPort: net.validPort(r.serveOwnedPort) ? r.serveOwnedPort : null,
    bind: net.BINDS.includes(r.bind) ? r.bind : null,
    port: net.validPort(r.port) ? r.port : net.DEFAULT_PORT,
    devices: Array.isArray(r.devices)
      ? r.devices
          .filter((d) => d && typeof d.id === 'string' && typeof d.tokenHash === 'string')
          .map((d) => ({
            id: d.id,
            name: String(d.name || 'Celular').slice(0, 40),
            tokenHash: d.tokenHash,
            createdAt: Number(d.createdAt) || 0,
            lastSeenAt: Number(d.lastSeenAt) || 0,
          }))
      : [],
  };
}
const friendly = (e, port) =>
  e.code === 'EADDRINUSE'
    ? 'A porta ' + port + ' já está em uso. Escolha outra.'
    : e.code === 'EACCES'
      ? 'Sem permissão para usar a porta ' + port + '.'
      : redact(e.message || String(e));

function createRemote({ ctx, methods, bus, staticRoot = path.join(__dirname, '../../dist-mobile'), deps = {} }) {
  const ts = deps.tailscale || tailscale;
  const log = deps.log || ((...args) => console.error('[remote]', ...args.map((a) => redact(String(a?.stack || a)))));
  // Native confirmation (dialog on the desktop). Without one nothing is ever granted.
  const confirm = deps.confirm || (async () => 'no');
  const now = deps.now || Date.now;
  const store = ctx.store;
  store.state.remote = normalizeRemote(store.state.remote);
  const cfg = () => store.state.remote;
  const devices = new Devices({ list: () => cfg().devices, save: () => store.save() });
  const pairing = new Pairing({ now: deps.now });
  const lastUse = new Map(); // deviceId -> last authenticated use (a long gap = a new session)
  const approvedQuests = new Map(); // questId -> signature of the full-access steps the desktop already approved
  const differ = createStateDiffer();
  const hub = createHub({ bus, getState: () => ctx.state(), differ });
  let server = null,
    runningPort = null,
    runningHosts = [],
    primary = null,
    lastError = '',
    starting = null,
    tsCache = { at: 0, value: null };

  const notice = (message) => ctx.bus?.emit({ type: 'remote-notice', message });
  const deviceLabel = (device, ip) => '"' + (device?.name || 'Celular') + '"' + (ip ? ' (' + ip + ')' : '');
  function onActivity(kind, device, info = {}) {
    if (kind === 'paired') {
      lastUse.set(device.id, now());
      notice('Aparelho ' + deviceLabel(device, info.ip) + ' pareado com o controle remoto.');
    } else if (kind === 'auth' || kind === 'connected') {
      const t = now(),
        previous = lastUse.get(device.id);
      lastUse.set(device.id, t);
      if (previous === undefined || t - previous > SESSION_GAP_MS)
        notice('O aparelho ' + deviceLabel(device, info.ip) + ' começou a usar o controle remoto.');
    }
    deps.onActivity?.(kind, device, info);
  }

  // ---- full access ("edit") granted from a phone needs a yes at the desktop ---------------------------------------
  async function requireFullAccess(device, ip, what) {
    const answer = await confirm({
      message: 'O aparelho ' + deviceLabel(device, ip) + ' quer dar acesso completo ' + what + '.',
      detail:
        'No acesso completo a IA lê e altera arquivos e roda comandos sem pedir permissão a cada passo. ' +
        'Só autorize se foi você que fez esse pedido agora.',
      okLabel: 'Dar acesso completo',
    });
    if (answer === 'yes') return;
    throw new RemoteError(
      403,
      answer === 'timeout'
        ? 'O desktop não respondeu a tempo. O acesso completo não foi concedido.'
        : 'O acesso completo foi recusado no desktop. Use o modo "Pedir permissão".'
    );
  }
  const stepsToRun = (q) =>
    (q.steps || []).filter((s) => s.mode === 'edit' && !['done', 'skipped', 'cancelled'].includes(s.status));
  const signature = (q) =>
    createHash('sha256')
      .update(JSON.stringify(stepsToRun(q).map((s) => [s.id, s.title, s.instructions, s.provider])))
      .digest('hex');

  async function dispatch(name, args, { device, ip } = {}) {
    if (name === 'bootstrap') {
      const integrations = Object.keys(ctx.integrations || {}).length
        ? ctx.integrations
        : await methods.refreshConnections();
      return {
        state: sanitizeState(ctx.state()),
        integrations: sanitizeIntegrations(integrations),
        serverTime: Date.now(),
      };
    }
    if (name === 'createChat') {
      // From a phone a chat is born asking for permission unless the user picks otherwise (Drael cannot ask: it reads).
      args = { ...args, mode: MODES.includes(args.mode) ? args.mode : args.provider === 'drael' ? 'read' : 'ask' };
      if (args.mode === 'edit') await requireFullAccess(device, ip, 'a um novo chat (' + args.provider + ')');
    } else if (name === 'updateChat' && args.mode === 'edit') {
      const chat = ctx.store.state.chats.find((c) => c.id === args.id);
      if (chat && chat.mode !== 'edit') await requireFullAccess(device, ip, 'ao chat "' + chat.title + '"');
    } else if (name === 'createQuest') {
      const steps = (args.steps || []).map((s) =>
        s && typeof s === 'object' && !Array.isArray(s) ? { ...s, mode: MODES.includes(s.mode) ? s.mode : 'ask' } : s
      );
      if (steps.some((s) => s?.mode === 'edit'))
        await requireFullAccess(device, ip, 'a etapas da quest "' + args.title + '"');
      args = { ...args, steps };
    } else if (name === 'startQuest' || name === 'resumeQuest' || name === 'retryStep') {
      // Steps can also arrive in edit mode from the planning AI: starting them is the moment to ask.
      const q = ctx.store.state.quests?.find((x) => x.id === args.id);
      if (q && stepsToRun(q).length && approvedQuests.get(q.id) !== signature(q)) {
        await requireFullAccess(
          device,
          ip,
          'à quest "' + q.title + '" (' + stepsToRun(q).length + ' etapa(s) em acesso completo)'
        );
        approvedQuests.set(q.id, signature(q));
      }
    }
    const out = await methods[name](args);
    if (name === 'createQuest') {
      const q = ctx.store.state.quests?.[0];
      if (q && stepsToRun(q).length) approvedQuests.set(q.id, signature(q)); // approved above
    }
    if (name === 'usage' || name === 'refreshUsage') return out;
    if (name === 'createChat') return { chat: sanitizeChat(out.chats[0]) };
    return { ok: true };
  }
  // Tailscale address: the CLI when there is one, otherwise an interface NAMED Tailscale (never just "100.x").
  async function addressesNow() {
    if (deps.addresses) return deps.addresses();
    return net.detectAddresses(os.networkInterfaces(), await tailscaleStatus());
  }
  const effectiveBind = async () => cfg().bind || net.defaultBind(await addressesNow());

  async function start() {
    if (server) return;
    if (starting) return starting;
    starting = (async () => {
      lastError = '';
      const r = net.resolveBind(await effectiveBind(), await addressesNow());
      if (r.error) {
        lastError = r.error;
        return;
      }
      hub.start();
      const s = createRemoteServer({
        devices,
        pairing,
        hub,
        dispatch,
        staticRoot,
        log,
        onActivity,
        confirmPairing: ({ name, ip }) =>
          confirm({
            message: "Autorizar o aparelho '" + name + "' (" + ip + ') a controlar o VeSTA?',
            detail:
              'Quem for autorizado controla as IAs deste computador: elas podem ler e alterar arquivos e rodar comandos. ' +
              'Autorize somente se você acabou de gerar o QR code e este é o seu aparelho.',
            okLabel: 'Autorizar',
          }),
      });
      try {
        runningPort = await s.listen(r.hosts, cfg().port);
        server = s;
        runningHosts = r.hosts;
        primary = r.primary;
      } catch (e) {
        lastError = friendly(e, cfg().port);
        hub.stop();
      }
    })();
    try {
      await starting;
    } finally {
      starting = null;
    }
  }
  async function stop() {
    pairing.clear();
    hub.stop();
    const s = server;
    server = null;
    runningPort = null;
    runningHosts = [];
    primary = null;
    if (s) await s.close();
  }
  async function tailscaleStatus(fresh = false) {
    if (!fresh && tsCache.value && Date.now() - tsCache.at < 4000) return tsCache.value;
    const value = await ts.status({ port: runningPort || cfg().port });
    tsCache = { at: Date.now(), value };
    return value;
  }
  async function status() {
    const c = cfg(),
      t = await tailscaleStatus(),
      addresses = await addressesNow(),
      bind = await effectiveBind();
    return {
      notice: c.notice || '',
      enabled: c.enabled,
      running: !!server,
      error: lastError,
      bind,
      bindIsDefault: !c.bind,
      port: c.port,
      listening: server ? runningHosts.map((h) => 'http://' + h + ':' + runningPort) : [],
      addresses,
      clients: hub.size,
      devices: devices.view(),
      tailscale: {
        installed: t.installed,
        running: !!t.running,
        dnsName: t.dnsName || '',
        serving: !!t.serving,
        // 'free' | 'ours' | 'foreign': whether port 443 of the tailnet is free, VeSTA's, or used by something else.
        serveState: t.serveState || 'free',
        // true when VeSTA itself published it (and will undo it on quit).
        serveOwned: !!c.serveOwnedPort,
        httpsUrl: t.httpsUrl || null,
        error: t.error || '',
      },
    };
  }
  // Applies the saved config: (re)starts or stops the server.
  async function apply() {
    await stop();
    if (cfg().enabled) await start();
  }
  async function configure(input) {
    const c = cfg();
    c.notice = ''; // any change made by the user dismisses the migration warning
    if (typeof input.bind === 'string') {
      if (!net.BINDS.includes(input.bind)) throw new Error('Interface inválida');
      c.bind = input.bind;
    }
    if (input.port !== undefined) {
      const port = Number(input.port);
      if (!net.validPort(port)) throw new Error('Porta inválida (use 1024 a 65535)');
      // The publication points at the old port: undo it (it is ours) before moving.
      if (port !== c.port) await unpublishQuietly();
      c.port = port;
    }
    if (typeof input.enabled === 'boolean') {
      if (!input.enabled && c.enabled) await unpublishQuietly();
      c.enabled = input.enabled;
    }
    store.save();
    await apply();
    return status();
  }
  // Undoes the `tailscale serve` publication, but only if VeSTA made it (serveOwnedPort) and it still points at our
  // port: a configuration of the user's own is never touched. Never throws.
  async function unpublishQuietly() {
    const c = cfg();
    if (!c.serveOwnedPort) return;
    try {
      await ts.unserve(c.serveOwnedPort);
    } catch (e) {
      log('não foi possível desfazer o tailscale serve:', e?.message || e);
      return;
    }
    c.serveOwnedPort = null;
    tsCache.at = 0;
    store.save();
  }
  async function createPairing() {
    if (!server) throw new Error('Ligue o controle remoto antes de parear um aparelho');
    const t = await tailscaleStatus();
    const base = t.httpsUrl || 'http://' + (primary.includes(':') ? '[' + primary + ']' : primary) + ':' + runningPort;
    const { code, expiresAt } = pairing.create();
    const url = base + '/#pair=' + code;
    const qr = await require('qrcode').toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return { code, url, qr, expiresAt, secure: base.startsWith('https:') };
  }
  async function setHttps(enable) {
    if (!server) throw new Error('Ligue o controle remoto primeiro');
    const t = await tailscaleStatus(true);
    if (!t.installed) throw new Error('Tailscale não encontrado. Instale em tailscale.com/download.');
    if (!t.running) throw new Error('Entre na sua conta do Tailscale primeiro.');
    if (enable) {
      // ts.serve refuses (ServeConflict) when 443 already serves something that is not ours.
      const r = await ts.serve(runningPort);
      if (r?.changed) {
        cfg().serveOwnedPort = runningPort;
        store.save();
      }
    } else if (cfg().serveOwnedPort) {
      await ts.unserve(cfg().serveOwnedPort);
      cfg().serveOwnedPort = null;
      store.save();
    } else if (t.serveState === 'ours' || t.serveState === 'foreign')
      throw new Error('Esta publicação HTTPS não foi criada pelo VeSTA. Para desfazê-la, use o próprio Tailscale.');
    tsCache.at = 0;
    return status();
  }
  // App quitting: stop the server and take our own HTTPS publication down (bounded, so quitting never hangs).
  async function shutdown(timeoutMs = 6000) {
    const limit = new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.());
    await Promise.race([Promise.allSettled([stop(), unpublishQuietly()]), limit]);
  }
  const api = {
    start,
    stop,
    shutdown,
    apply,
    status,
    configure,
    createPairing,
    setHttps,
    devices,
    hub,
    dispatch,
    get server() {
      return server;
    },
    get port() {
      return runningPort;
    },
    revoke(id) {
      server?.closeDevice(id);
      return devices.revoke(id);
    },
  };
  return api;
}

// Desktop-only methods (merged into the IPC surface, never into the remote allowlist).
function remoteMethods(ctx) {
  const remote = () => {
    if (!ctx.remote) throw new Error('Controle remoto indisponível');
    return ctx.remote;
  };
  return {
    remoteStatus: () => remote().status(),
    remoteConfigure: (input) => remote().configure(input || {}),
    remotePairing: () => remote().createPairing(),
    remoteRenameDevice: async ({ id, name }) => {
      if (!remote().devices.rename(String(id), name)) throw new Error('Aparelho não encontrado');
      return remote().status();
    },
    remoteRevokeDevice: async ({ id }) => {
      if (!remote().revoke(String(id))) throw new Error('Aparelho não encontrado');
      return remote().status();
    },
    remoteHttps: ({ enable }) => remote().setHttps(!!enable),
  };
}
module.exports = { createRemote, remoteMethods, normalizeRemote, defaultRemote };
