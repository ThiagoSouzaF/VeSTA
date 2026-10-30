const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { redact } = require('./memory.cjs');

// The MCP servers VeSTA itself offers to the chats it opens (vesta-quest, vesta-app) live inside the main process:
// loopback only, a free port, and one random bearer token per chat and per app run. The token IS the scope: it maps to
// one chat, and every tool runs as that chat; the model never names the chat it acts for.
//   name                  server name the CLIs see (tools appear as mcp__<name>__<tool>)
//   tools                 [[name, description, inputSchema], ...]
//   authorize(chatId)     the chat (or any value handlers need) when it may use the server now, else null
//   tools(subject)?       when given as `visible`, the subset of tool names listed/callable for that subject
//   call(subject, name, args)   runs a tool (args already filtered to the declared properties)
const MAX_BODY = 1_000_000;

function createMcpHost({ name, tools, authorize, visible = () => null, call }) {
  const tokens = new Map(); // token -> chatId
  const byChat = new Map(); // chatId -> token
  let server = null,
    starting = null,
    port = 0;
  const allowed = (subject) => {
    const names = visible(subject);
    return names ? tools.filter((t) => names.includes(t[0])) : tools;
  };
  function authenticate(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    let found = null;
    for (const [token, chatId] of tokens) {
      const a = Buffer.from(token),
        b = Buffer.from(m[1]);
      if (a.length === b.length && timingSafeEqual(a, b)) found = chatId;
    }
    return found && { chatId: found, subject: authorize(found) };
  }
  function buildServer(chatId) {
    const s = new Server({ name, version: '1.0.0' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allowed(authorize(chatId) || null).map(([n, description, inputSchema]) => ({
        name: n,
        description,
        inputSchema,
      })),
    }));
    s.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      try {
        // Checked again per call: the chat may have been deleted or lost access since the request was authenticated.
        const subject = authorize(chatId);
        if (!subject)
          throw Object.assign(new Error('Este chat não tem mais acesso a estas ferramentas'), { userSafe: true });
        const def = allowed(subject).find((t) => t[0] === params.name);
        if (!def) throw Object.assign(new Error('Ferramenta indisponível: ' + params.name), { userSafe: true });
        // Only the declared arguments get through: nothing the model sends can overwrite what the token fixed.
        const given = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const clean = Object.fromEntries(Object.entries(given).filter(([k]) => k in def[2].properties));
        const result = await call(subject, params.name, clean);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const message = e.userSafe || e.name === 'UserError' ? e.message : 'Erro: ' + redact(e.message);
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    });
    return s;
  }
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error('corpo grande demais'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  const reply = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  async function handle(req, res) {
    // A page in the browser cannot reach this server by DNS rebinding: only the loopback host names are served.
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return reply(res, 403, { error: 'host' });
    if (!/^\/mcp\/?$/.test((req.url || '').split('?')[0])) return reply(res, 404, { error: 'not found' });
    const auth = authenticate(req);
    if (!auth?.subject) return reply(res, 401, { error: 'unauthorized' });
    if (req.method !== 'POST') return reply(res, 405, { error: 'method not allowed' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return reply(res, 400, { error: 'invalid json' });
    }
    // Stateless: a server and transport per request, bound to the chat that owns the token.
    const mcp = buildServer(auth.chatId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      mcp.close().catch(() => {});
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }
  async function start() {
    if (server) return;
    starting ||= new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) reply(res, 500, { error: 'internal' });
          else res.end();
        });
      });
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        server = s;
        port = s.address().port;
        resolve();
      });
    }).finally(() => {
      starting = null;
    });
    await starting;
  }
  return {
    NAME: name,
    // Address and credential for a chat that may use this server; null otherwise. Starts the server on first use.
    async endpointFor(chat) {
      if (!chat?.id || !authorize(chat.id)) return null;
      await start();
      let token = byChat.get(chat.id);
      if (!token) {
        token = randomBytes(24).toString('hex');
        byChat.set(chat.id, token);
        tokens.set(token, chat.id);
      }
      return { name, url: 'http://127.0.0.1:' + port, mcp: 'http://127.0.0.1:' + port + '/mcp', token };
    },
    close() {
      const s = server;
      server = null;
      tokens.clear();
      byChat.clear();
      return new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()));
    },
  };
}
module.exports = { createMcpHost };
