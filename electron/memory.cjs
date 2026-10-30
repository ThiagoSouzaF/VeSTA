const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const redact = (text) =>
  String(text)
    .replace(/\b(?:sk-|dk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g, '[chave removida]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[chave removida]')
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[token removido]')
    .replace(/(?:AKIA|ASIA)[0-9A-Z]{16}/g, '[chave removida]')
    .replace(/(Bearer\s+)[\w.~+/-]{12,}=*/gi, '$1[removido]')
    .replace(
      /((?:api[_-]?key|authorization|password|passwd|senha|token|secret|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[removido]'
    );
const scope = (projectId) => ({ workspace: 'vesta', project: projectId || 'inbox' });
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Namespace VeSTA declares as the producer of its sessions' lifecycle events (docs: external-lifecycle.md).
const PRODUCER = 'vesta.desktop';
// Event names VeSTA uses internally -> the canonical lifecycle names of the server.
const CANONICAL = { 'user-prompt': 'user-prompt-submit' };
// Agent name the server records for each provider (the wire names of the harnesses; drael has its own).
const AGENTS = { claude: 'claude-code', codex: 'codex', opencode: 'opencode', drael: 'drael' };
const agentName = (provider) => AGENTS[provider] || 'codex';
// Stable retry identity (docs): built once from the event's identity, never from its content.
function ingestKey({ agent, sessionId, event, eventId }) {
  return createHash('sha256')
    .update(
      JSON.stringify(['external-capture-v1', PRODUCER, 'vesta', agent, sessionId, event, String(eventId)]),
      'utf8'
    )
    .digest('hex');
}
// Item of a /hook/batch request: { url, body } with the provenance and the stable key in the query string.
function batchItem({ event, agent, projectId, payload, eventId }) {
  const name = CANONICAL[event] || event;
  const sessionId = String(payload.session_id || '');
  const q = new URLSearchParams({
    event: name,
    agent,
    ...scope(projectId),
    cwd: payload.cwd || '',
    extension: PRODUCER,
    source_event: name,
    ...(sessionId && eventId != null ? { ingest_key: ingestKey({ agent, sessionId, event: name, eventId }) } : {}),
  });
  return { url: '/hook?' + q, body: payload };
}
// ---- Server identity (port + token), kept so the hook spool never points at a dead address -------------------------
const identityFile = (dir) => path.join(dir, 'vesta-server.json');
function readIdentity(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(identityFile(dir), 'utf8'));
    if (Number.isInteger(j.port) && typeof j.token === 'string' && j.token.length >= 16)
      return { port: j.port, token: j.token, url: 'http://127.0.0.1:' + j.port };
  } catch {}
  return {};
}
function writeIdentity(dir, { port, token }) {
  try {
    const tmp = identityFile(dir) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ port, token }), 'utf8');
    fs.renameSync(tmp, identityFile(dir));
  } catch {}
}
// ---- Orphans and the data-dir lock ---------------------------------------------------------------------------------
const pidOf = (text, re) => {
  const n = Number((re.exec(String(text)) || [])[1]);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
// Executable name of a process ('' when unknown). Only ai-memory processes are ever touched.
function imageOf(pid) {
  if (process.platform !== 'win32') return 'ai-memory';
  try {
    const out = execFileSync('tasklist.exe', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    return /^"([^"]+)"/.exec(out.trim())?.[1] || '';
  } catch {
    return '';
  }
}
async function killPid(pid) {
  try {
    process.kill(pid);
  } catch {}
  for (let i = 0; i < 40 && alive(pid); i++) await wait(50);
}
// Does a server answer on this identity (and accept its token)?
async function healthy({ url, token }) {
  if (!url || !token) return false;
  try {
    const r = await fetch(url + '/admin/profile/status', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}
// An HTTP server outlives a crashed app and keeps the data-dir lock. Before starting, look at who holds it:
//  - `vesta-server.pid` (ours) and `.serve.lock.holder` (`pid=N`, written by the server itself);
//  - a pid that is gone, or now belongs to another program (pid reuse), is stale: its holder file is removed;
//  - a live ai-memory that answers with our identity is adopted (reused);
//  - a live ai-memory that does not answer is ended (the dir is ours, so it can only be our own leftover).
// Returns { adopted: {pid}|null, killed: [pid], stale: [pid], removed: [file] }.
async function reclaim(dir, { identity = {}, isAlive = alive, image = imageOf, end = killPid, probe = healthy } = {}) {
  const out = { adopted: null, killed: [], stale: [], removed: [] };
  const files = [
    { file: path.join(dir, 'vesta-server.pid'), re: /(\d+)/ },
    { file: path.join(dir, '.serve.lock.holder'), re: /pid=(\d+)/ },
  ];
  const seen = new Map();
  for (const { file, re } of files) {
    let pid = 0;
    try {
      pid = pidOf(fs.readFileSync(file, 'utf8'), re);
    } catch {}
    if (pid && pid !== process.pid) seen.set(pid, [...(seen.get(pid) || []), file]);
    else if (!pid && fs.existsSync(file)) seen.set(0, [...(seen.get(0) || []), file]);
  }
  const forget = (list) => {
    for (const f of list) {
      if (path.basename(f) === 'vesta-server.pid' || path.basename(f) === '.serve.lock.holder')
        try {
          fs.rmSync(f, { force: true });
          out.removed.push(f);
        } catch {}
    }
  };
  for (const [pid, list] of seen) {
    if (!pid) {
      forget(list);
      continue;
    }
    if (!isAlive(pid) || !/ai-memory/i.test(image(pid))) {
      out.stale.push(pid);
      forget(list);
      continue;
    }
    if (identity.port && (await probe(identity))) {
      out.adopted = { pid };
      continue;
    }
    await end(pid);
    out.killed.push(pid);
    forget(list);
  }
  return out;
}
// What a human should do about a start failure.
function explainStartError(log, dir) {
  const m = /another ai-memory serve process appears to be using[^\n]*?pid=(\d+)/i.exec(log || '');
  if (m)
    return (
      'Outro processo do AI Memory (pid ' +
      m[1] +
      ') está usando a pasta de memória e não respondeu. O VeSTA tentou liberá-la sozinho; se a mensagem voltar, feche o ai-memory.exe desse pid e reabra o VeSTA.'
    );
  return String(log || '')
    .trim()
    .split('\n')
    .pop();
}
// One HTTP server owns the data dir (ai-memory refuses a second `serve` on it); the app and every agent it launches share it.
class Memory {
  // `options.env()` adds server environment read at every start (the consolidation LLM comes from the preferences).
  constructor(exe, dir, options = {}) {
    this.exe = exe;
    this.dir = dir;
    this.extraEnv = options.env || (() => ({}));
    this.client = null;
    this.server = null;
    this.adopted = 0;
    this.endpoint = null;
    this.pending = null;
    this.error = null;
    this.log = '';
    this.spool = null; // last drain of the hook spool: { at, before, after, rewritten }
    this.draining = null;
  }
  // Events queued while no server answered are delivered once one does (also those aimed at an older port).
  drainLater() {
    if (this.draining || !spoolCount(this.dir)) return;
    this.draining = new Promise((r) => setImmediate(r))
      .then(() => this.drainSpool())
      .then((r) => (this.spool = { at: Date.now(), ...r }))
      .catch((e) => (this.spool = { at: Date.now(), error: e.message }))
      .finally(() => (this.draining = null));
  }
  async start() {
    if (this.endpoint && ((this.server && this.server.exitCode === null) || (this.adopted && alive(this.adopted))))
      return this.endpoint;
    this.adopted = 0;
    fs.mkdirSync(this.dir, { recursive: true });
    const config = path.join(this.dir, 'config.toml');
    // FTS works offline, without downloading an embedding model or calling a cloud provider.
    if (!fs.existsSync(config)) fs.writeFileSync(config, 'embedding_provider = "none"\nlog_level = "warn"\n');
    const pidFile = path.join(this.dir, 'vesta-server.pid');
    // The port and token are kept in the data dir: events that reach the hook spool carry the server URL, so a new
    // port on every start would orphan them. A busy port falls back to a new one (and recover rewrites the spool).
    const saved = readIdentity(this.dir);
    const reclaimed = await reclaim(this.dir, { identity: saved });
    if (reclaimed.adopted) {
      this.adopted = reclaimed.adopted.pid;
      this.endpoint = { url: saved.url, mcp: saved.url + '/mcp', token: saved.token };
      this.drainLater();
      return this.endpoint;
    }
    // The previous server may still be letting go of its port (it was just closed): give it a moment before moving.
    let reuse = false;
    for (let i = 0; saved.port && i < 12 && !reuse; i++) {
      reuse = await portFree(saved.port);
      if (!reuse) await wait(150);
    }
    const port = reuse ? saved.port : await freePort(),
      token = saved.token || randomBytes(24).toString('hex'),
      url = 'http://127.0.0.1:' + port;
    writeIdentity(this.dir, { port, token });
    // Loopback only, and a bearer token keeps other local processes out of the store.
    const server = spawn(
      this.exe,
      [
        '--data-dir',
        this.dir,
        'serve',
        '--transport',
        'http',
        '--bind',
        '127.0.0.1:' + port,
        '--workspace',
        'vesta',
        '--project',
        'inbox',
      ],
      {
        env: { ...process.env, ...this.extraEnv(), AI_MEMORY_EMBEDDING_PROVIDER: 'none', AI_MEMORY_AUTH_TOKEN: token },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    this.server = server;
    try {
      fs.writeFileSync(pidFile, String(server.pid));
    } catch {}
    const logs = (b) => (this.log = (this.log + b).slice(-6000));
    server.stdout.on('data', logs);
    server.stderr.on('data', logs);
    server.on('exit', () => {
      if (this.server === server) {
        this.server = null;
        this.endpoint = null;
        this.client = null;
      }
    });
    for (let i = 0; i < 100 && server.exitCode === null; i++) {
      try {
        if ((await fetch(url + '/healthz')).ok) {
          this.endpoint = { url, mcp: url + '/mcp', token };
          this.error = null;
          this.drainLater();
          return this.endpoint;
        }
      } catch {}
      await wait(150);
    }
    stop(server);
    const message = explainStartError(this.log, this.dir) || 'O AI Memory não iniciou';
    this.error = message;
    throw new Error(message);
  }
  async connect() {
    if (this.client && (this.server || this.adopted)) return this.client;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const { mcp, token } = await this.start();
      const transport = new StreamableHTTPClientTransport(new URL(mcp), {
        requestInit: { headers: { Authorization: 'Bearer ' + token } },
      });
      const client = new Client({ name: 'vesta', version: '0.1.0' });
      client.onclose = () => {
        if (this.client === client) this.client = null;
      };
      try {
        await client.connect(transport);
        this.client = client;
        this.error = null;
        return client;
      } catch (e) {
        this.error = e.message;
        await transport.close().catch(() => {});
        throw e;
      }
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  // Address and credential handed to agents; starts the server when needed.
  async agentEndpoint() {
    await this.connect();
    return this.endpoint;
  }
  // A failure is a JSON-RPC error (thrown by the SDK), `result.isError`, or a JSON payload carrying `error`.
  async call(name, args, { timeout = 20000 } = {}) {
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
    const text = (result.content || [])
      .filter((x) => x.type === 'text')
      .map((x) => x.text)
      .join('\n');
    if (result.isError) throw new Error(text || 'Falha no AI Memory');
    const failure = payloadError(text);
    if (failure) throw new Error(failure);
    return text;
  }
  // A fresh project has no wiki yet: memory_query/memory_status fail until its first page exists.
  async ensureProject(projectId) {
    try {
      await this.call('memory_status', scope(projectId));
    } catch (e) {
      if (!/not found in workspace/.test(e.message)) throw e;
      await this.call('memory_write_page', {
        path: 'vesta/space.md',
        body: '# Espaço de trabalho\n\nEspaço de memória criado pelo VeSTA.',
        ...scope(projectId),
      });
    }
  }
  async query(query, projectId) {
    const terms =
      String(query)
        .match(/[\p{L}\p{N}_-]{3,}/gu)
        ?.slice(0, 12) || [];
    if (!terms.length) return '';
    const expression = terms.map((t) => '"' + t.replace(/"/g, '') + '"').join(' OR ');
    const args = { query: expression, ...scope(projectId), limit: 6 };
    try {
      return await this.call('memory_query', args);
    } catch (e) {
      if (!/project .+ not found in workspace/.test(e.message)) throw e;
      await this.ensureProject(projectId);
      return this.call('memory_query', args);
    }
  }
  // Start of a conversation: a deterministic snapshot of the project (no LLM) instead of a guess at keywords.
  // Returns a compact text; throws when the server cannot brief (the caller falls back to `query`).
  async briefing(projectId) {
    const args = { ...scope(projectId), settled_first: true, recent_pages_limit: 8 };
    let raw;
    try {
      raw = await this.call('memory_briefing', args);
    } catch (e) {
      if (!/not found in workspace/.test(e.message)) throw e;
      await this.ensureProject(projectId);
      raw = await this.call('memory_briefing', args);
    }
    return briefingText(raw);
  }
  // Standing preferences ("how the user works"), shared by every project. [{path, category, statement, ...}]
  async profile() {
    const { url, token } = await this.start();
    const r = await fetch(url + '/admin/profile/list', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error('AI Memory não listou o perfil (' + r.status + ')');
    const body = await r.json();
    return (body.entries || []).map((e) => ({
      path: String(e.path),
      category: String(e.category || ''),
      statement: String(e.statement || ''),
      appliesTo: e.applies_to || [],
    }));
  }
  // Writes one profile entry: profile/<category>/<subject>.md, replacing an entry of the same path.
  async profileWrite({ path: existing, category, subject, statement }) {
    const slug = (t) =>
      String(t || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    const file = existing
      ? String(existing).replace(/^profile\//, '')
      : (slug(category) || 'habits') + '/' + (slug(subject) || 'geral') + '.md';
    await this.call('memory_write_page', {
      path: file,
      body: '# ' + String(subject || 'Preferência').replace(/\n/g, ' ') + '\n\n' + redact(statement),
      tier: 'semantic',
      tags: ['vesta', 'preferencia'],
      scope: 'profile',
    });
    return 'profile/' + file;
  }
  async profileRemove(p) {
    return this.call('memory_delete_page', { path: String(p).replace(/^profile\//, ''), scope: 'profile' });
  }
  async write(note) {
    return this.call('memory_write_page', {
      path: note.path,
      body: '# ' + note.title.replace(/\n/g, ' ') + '\n\n' + redact(note.body),
      tier: note.kind === 'session' ? 'episodic' : 'semantic',
      tags: ['vesta', note.kind || 'note'],
      ...(note.kind === 'preference' ? { scope: 'profile' } : scope(note.projectId)),
    });
  }
  async remove(note) {
    return this.call('memory_delete_page', {
      path: note.path,
      ...(note.kind === 'preference' ? { scope: 'profile' } : scope(note.projectId)),
    });
  }
  // Cross-agent handoff for the next AI of a chat (the server hands it to the next session that opens the project).
  async handoff({ projectId, summary, nextSteps = [], cwd = '' }) {
    return this.call('memory_handoff_begin', {
      ...scope(projectId),
      summary: redact(summary).slice(0, 1500),
      next_steps: nextSteps.map((t) => redact(t).slice(0, 300)),
      ...(cwd ? { cwd } : {}),
    });
  }
  // Ordered lifecycle events through POST /hook/batch: the producer is declared (`extension`), every event has a stable
  // key and an inline acknowledgement. `items` = [{event, agent, projectId, payload, eventId}].
  async batch(items) {
    const { url, token } = await this.start();
    const r = await fetch(url + '/hook/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(items.map(batchItem)),
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    let reply = null;
    try {
      reply = JSON.parse(text);
    } catch {}
    if (!r.ok && !reply) throw new Error('AI Memory recusou os eventos (' + r.status + ')');
    if (reply && typeof reply.accepted === 'number' && reply.accepted < items.length)
      throw new Error('AI Memory aceitou só ' + reply.accepted + ' de ' + items.length + ' eventos');
    if (!r.ok) throw new Error('AI Memory recusou os eventos (' + r.status + ')');
    return reply;
  }
  // Lifecycle event of a conversation (one-item batch). `agent` is the server's name of the harness.
  async hook(event, agent, payload, projectId, eventId) {
    return this.batch([{ event, agent, projectId, payload, eventId }]);
  }
  // The assistant's answer only reaches the store through the native hook binary, which sanitizes and caps it (2 KB)
  // before sending; the server must run with AI_MEMORY_CAPTURE_ASSISTANT=true.
  async stopWithAnswer(agent, payload) {
    const { url, token } = await this.start();
    await new Promise((resolve, reject) => {
      const child = spawn(
        this.exe,
        [
          '--data-dir',
          this.dir,
          'hook',
          '--event',
          'stop',
          '--agent',
          agent,
          '--capture-assistant',
          '--server-url',
          url,
        ],
        { env: { ...process.env, AI_MEMORY_AUTH_TOKEN: token }, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }
      );
      let err = '';
      const timer = setTimeout(() => child.kill(), 15000);
      child.stderr.on('data', (b) => (err = (err + b).slice(-2000)));
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(err.trim().split('\n').pop() || 'hook stop falhou (' + code + ')'));
      });
      // The hook may exit before reading stdin (bad token, missing binary): EPIPE must not reach the main process.
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(payload));
    });
  }
  // Events that could not be delivered (server down at that moment) wait in <dir>/hook-spool with the server URL they
  // were aimed at. Points them at the current server and asks the binary to drain them. Safe to repeat.
  // Returns { before, after, rewritten } (file counts).
  async drainSpool({ timeout = 60000 } = {}) {
    const { url, token } = await this.start();
    const rewritten = retargetSpool(this.dir, url, token);
    const before = spoolCount(this.dir);
    if (!before) return { before: 0, after: 0, rewritten };
    await new Promise((resolve) => {
      const child = spawn(this.exe, ['--data-dir', this.dir, 'recover', '--json'], {
        env: { ...process.env, AI_MEMORY_AUTH_TOKEN: token, AI_MEMORY_SERVER_URL: url },
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      const timer = setTimeout(() => child.kill(), timeout);
      child.on('error', () => resolve());
      child.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return { before, after: spoolCount(this.dir), rewritten };
  }
  // Snapshot of wiki/, db/ and config taken by the running server (consistent while agents write) into a .tar.gz.
  async backupTo(file) {
    const { url, token } = await this.start();
    await new Promise((resolve, reject) => {
      const child = spawn(this.exe, ['--data-dir', this.dir, 'backup', '--to', file], {
        env: { ...process.env, AI_MEMORY_AUTH_TOKEN: token, AI_MEMORY_SERVER_URL: url },
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (b) => (err = (err + b).slice(-2000)));
      const timer = setTimeout(() => child.kill(), 120000);
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(file)) resolve();
        else reject(new Error('o AI Memory não gerou o backup (' + (err.trim().split('\n').pop() || code) + ')'));
      });
    });
  }
  // The server is stopped synchronously first: before-quit does not wait for this promise.
  async close() {
    const server = this.server,
      client = this.client,
      adopted = this.adopted;
    this.client = null;
    this.server = null;
    this.adopted = 0;
    this.endpoint = null;
    if (server) stop(server);
    else if (adopted)
      try {
        process.kill(adopted);
      } catch {}
    await client?.close().catch(() => {});
  }
}
// The server is a direct child (no shell), so kill() ends it at once, even during app quit.
function stop(child) {
  if (child?.pid && child.exitCode === null)
    try {
      child.kill();
    } catch {}
}
// Tool answers that report their failure inside a JSON payload instead of `isError`.
function payloadError(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('{')) return '';
  try {
    const j = JSON.parse(t);
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      if (j.error) return typeof j.error === 'string' ? j.error : j.error.message || JSON.stringify(j.error);
      if (j.ok === false || j.success === false) return j.message || j.reason || 'Falha no AI Memory';
      if (j.reason === 'precondition_failed') return 'A página mudou antes da gravação (precondition_failed)';
    }
  } catch {}
  return '';
}
// memory_briefing JSON -> a few lines the agent (and the user) can read.
function briefingText(raw) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return String(raw || '').slice(0, 3000);
  }
  const lines = [];
  const c = j.counts || {};
  lines.push(
    'Projeto ' +
      (j.scope?.project || '') +
      ': ' +
      (c.pages_latest ?? 0) +
      ' páginas, ' +
      (c.sessions ?? 0) +
      ' sessões' +
      (j.activity_7d ? ' (' + j.activity_7d.sessions + ' nos últimos 7 dias)' : '') +
      '.'
  );
  if (j.pending_handoff_count)
    lines.push(j.pending_handoff_count + ' passagem(ns) de contexto pendente(s) de outra IA.');
  for (const r of j.rules || []) lines.push('Regra: ' + (r.title || r.path) + (r.path ? ' (' + r.path + ')' : ''));
  for (const s of j.slots || []) lines.push('Decisão: ' + (s.title || s.path || JSON.stringify(s)).slice(0, 200));
  if ((j.recent_pages || []).length)
    lines.push(
      'Páginas recentes: ' +
        j.recent_pages
          .slice(0, 8)
          .map((p) => (p.title || p.path) + ' (' + p.path + ')')
          .join('; ')
    );
  return lines.join('\n').slice(0, 3000);
}
// ---- Hook spool ------------------------------------------------------------------------------------------------------
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
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(item));
      fs.renameSync(tmp, file);
      changed++;
    } catch {}
  }
  return changed;
}
module.exports = {
  Memory,
  redact,
  scope,
  reclaim,
  retargetSpool,
  spoolCount,
  batchItem,
  ingestKey,
  agentName,
  briefingText,
  payloadError,
  readIdentity,
  explainStartError,
  alive,
  imageOf,
  killPid,
  PRODUCER,
};
