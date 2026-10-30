// The Memory class: one HTTP ai-memory server per data dir, shared by the app and every agent it launches.
// The pieces around it live in redact / protocol / server-lock / spool / text; their names are re-exported here.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { childEnv } = require('../app/privacy.cjs');
const { sleep, freePort, portFree } = require('../util/sys.cjs');
const { lastLine, slug } = require('../util/text.cjs');
const { redact } = require('./redact.cjs');
const { PRODUCER, agentName, ingestKey, batchItem, scope } = require('./protocol.cjs');
const { readIdentity, writeIdentity, alive, imageOf, killPid, reclaim, explainStartError } = require('./server-lock.cjs');
const { spoolCount, retargetSpool } = require('./spool.cjs');
const { briefingText, payloadError } = require('./text.cjs');
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
      if (!reuse) await sleep(150);
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
        env: childEnv({ ...this.extraEnv(), AI_MEMORY_EMBEDDING_PROVIDER: 'none', AI_MEMORY_AUTH_TOKEN: token }),
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
      await sleep(150);
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
    const file = existing
      ? String(existing).replace(/^profile\//, '')
      : (slug(category, 60, '') || 'habits') + '/' + (slug(subject, 60, '') || 'geral') + '.md';
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
        { env: childEnv({ AI_MEMORY_AUTH_TOKEN: token }), windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }
      );
      let err = '';
      const timer = setTimeout(() => child.kill(), 15000);
      child.stderr.on('data', (b) => (err = (err + b).slice(-2000)));
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(lastLine(err) || 'hook stop falhou (' + code + ')'));
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
        env: childEnv({ AI_MEMORY_AUTH_TOKEN: token, AI_MEMORY_SERVER_URL: url }),
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
        env: childEnv({ AI_MEMORY_AUTH_TOKEN: token, AI_MEMORY_SERVER_URL: url }),
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
        else reject(new Error('o AI Memory não gerou o backup (' + (lastLine(err) || code) + ')'));
      });
    });
  }
  // The server is stopped synchronously first: before-quit does not wait for this promise.
  // What the memory screen shows about the server, without reaching into the fields.
  status() {
    return { dir: this.dir, mcp: this.endpoint?.mcp, spool: this.spool };
  }
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
