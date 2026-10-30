const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { redact } = require('./memory.cjs');

// "vesta-quest": the MCP server the quest's own chat uses to run its quest (inspect, reorganize, steer the step chats).
// It lives inside the main process: loopback only, a free port, and one random bearer token per chat and per app run.
// The token IS the scope: it maps to one lead chat, and that chat's quest is the only thing any tool can touch. The model
// never names a quest; tools take step or chat ids and the engine refuses the ones outside that quest.
const NAME = 'vesta-quest';
const BY = 'chat da quest';
const MAX_BODY = 1_000_000;

const str = (description) => ({ type: 'string', description });
const stepId = str('Id da etapa (ex.: "s2"), como em quest_get.');
const PROVIDER = {
  type: 'string',
  enum: ['claude', 'codex', 'opencode', 'drael'],
  description: 'IA da etapa (instalada).',
};
const MODE = {
  type: 'string',
  enum: ['edit', 'read', 'ask'],
  description: 'edit = acesso completo, read = só consulta, ask = pede permissão.',
};
const stepFields = {
  provider: PROVIDER,
  model: str('Modelo da IA; vazio = padrão da conta. Ao trocar de IA sem informar, volta ao padrão.'),
  mode: MODE,
  title: str('Título curto da etapa.'),
  instructions: str('Instruções completas (a IA da etapa não vê a conversa da quest).'),
  dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ids das etapas que precisam terminar antes.' },
};
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const TOOLS = [
  [
    'quest_get',
    'Estado completo da quest: etapas (IA, modelo, modo, dependências, resultados), IAs disponíveis e diário.',
    obj(),
  ],
  [
    'step_update',
    'Altera IA, modelo, modo, título, instruções ou dependências de uma etapa pendente ou com problema (a quest pode estar rodando). Etapas rodando, concluídas ou puladas são recusadas.',
    obj({ stepId, ...stepFields }, ['stepId']),
  ],
  [
    'step_add',
    'Acrescenta uma etapa pendente ao fim do plano.',
    obj({ ...stepFields, kind: { type: 'string', enum: ['work', 'review'] } }, ['title', 'instructions']),
  ],
  [
    'step_remove',
    'Remove uma etapa pendente (as que dependiam dela herdam suas dependências).',
    obj({ stepId }, ['stepId']),
  ],
  ['step_retry', 'Tenta de novo uma etapa com problema.', obj({ stepId }, ['stepId'])],
  ['step_skip', 'Pula uma etapa pendente ou com problema.', obj({ stepId }, ['stepId'])],
  ['quest_start', 'Inicia a quest (rascunho com plano válido).', obj()],
  ['quest_pause', 'Pausa a quest: as etapas em curso terminam e nenhuma nova começa.', obj()],
  ['quest_resume', 'Retoma uma quest pausada.', obj()],
  [
    'chat_read',
    'Lê o histórico COMPLETO do chat de uma etapa, em páginas, com atividades, subagentes e comandos resumidos. Se "proximo" vier preenchido, chame de novo com desde/deslocamento dele.',
    obj(
      {
        stepId,
        chatId: str('Alternativa a stepId: id de um chat de etapa desta quest.'),
        desde: { type: 'integer', minimum: 0, description: 'Índice da primeira mensagem (padrão 0).' },
        deslocamento: {
          type: 'integer',
          minimum: 0,
          description: 'Posição em caracteres dentro dessa mensagem (padrão 0).',
        },
        limite: { type: 'integer', minimum: 1, maximum: 30, description: 'Máximo de mensagens por página (padrão 8).' },
      },
      []
    ),
  ],
  [
    'chat_send',
    'Envia uma mensagem ao chat de uma etapa. Falha se o chat estiver respondendo.',
    obj({ stepId, mensagem: str('Texto enviado como se a pessoa o tivesse digitado nesse chat.') }, [
      'stepId',
      'mensagem',
    ]),
  ],
  [
    'activity_get',
    'Tarefas em andamento nos chats desta quest: respostas, comandos, subagentes e segundo plano.',
    obj(),
  ],
  [
    'task_stop',
    'Encerra uma tarefa em andamento (taskId vem de activity_get) num chat desta quest.',
    obj({ chatId: str('Id do chat da etapa.'), taskId: str('Id da tarefa.') }, ['chatId', 'taskId']),
  ],
  ['chat_stop', 'Interrompe a resposta em andamento do chat de uma etapa.', obj({ stepId }, ['stepId'])],
];

const stepView = (q, id) => {
  const s = q.steps.find((x) => x.id === id);
  return (
    s && {
      id: s.id,
      titulo: s.title,
      status: s.status,
      ia: s.provider,
      modelo: s.model,
      modo: s.mode,
      dependeDe: s.dependsOn,
    }
  );
};
const need = (args, key) => {
  const v = args?.[key];
  if (typeof v !== 'string' || !v.trim()) throw Object.assign(new Error('Informe ' + key), { userSafe: true });
  return v;
};

// Tool handlers: (engine, questId, args) -> JSON-able result. The quest id comes from the token, never from `args`.
function handlers(engine) {
  const stepResult = (q, id, extra = {}) => ({ ok: true, situacao: q.status, etapa: stepView(q, id), ...extra });
  const questOp = (name, op, note) => async (id) => {
    const q = await engine[op]({ id });
    engine.log({ id, text: 'Chat da quest: ' + note + '.' });
    return { ok: true, situacao: q.status, tool: name };
  };
  return {
    quest_get: (id) => engine.questState({ id }),
    step_update: (id, a) => {
      const { stepId: sid, ...patch } = a;
      const q = engine.updateStep({ ...patch, id, stepId: need(a, 'stepId'), by: BY });
      return stepResult(q, sid);
    },
    step_add: (id, a) => {
      const q = engine.addStep({ ...a, id, by: BY });
      return stepResult(q, q.steps.at(-1).id);
    },
    step_remove: (id, a) => {
      const q = engine.removeStep({ id, stepId: need(a, 'stepId'), by: BY });
      return { ok: true, situacao: q.status, removida: a.stepId, restantes: q.steps.map((s) => s.id) };
    },
    step_retry: (id, a) => {
      const q = engine.retryStep({ id, stepId: need(a, 'stepId') });
      engine.log({ id, text: 'Chat da quest: nova tentativa de ' + a.stepId + '.' });
      return stepResult(q, a.stepId);
    },
    step_skip: (id, a) => {
      const q = engine.skipStep({ id, stepId: need(a, 'stepId') });
      engine.log({ id, text: 'Chat da quest: pulou ' + a.stepId + '.' });
      return stepResult(q, a.stepId);
    },
    quest_start: questOp('quest_start', 'startQuest', 'iniciou a quest'),
    quest_pause: questOp('quest_pause', 'pauseQuest', 'pausou a quest'),
    quest_resume: questOp('quest_resume', 'resumeQuest', 'retomou a quest'),
    chat_read: (id, a) => engine.chatRead({ ...a, id }),
    chat_send: (id, a) => engine.chatSend({ id, stepId: need(a, 'stepId'), text: need(a, 'mensagem') }),
    activity_get: (id) => engine.activity({ id }),
    task_stop: (id, a) => engine.stopTask({ id, chatId: need(a, 'chatId'), taskId: need(a, 'taskId') }),
    chat_stop: (id, a) => engine.stopStepChat({ id, stepId: need(a, 'stepId') }),
  };
}

// `ctx` supplies the store (to find the calling chat) and `engine` the quest operations (createQuestEngine's result, or
// a getter for it, since the engine is created after the context).
function createQuestMcp(ctx, { engine }) {
  const getEngine = typeof engine === 'function' ? engine : () => engine;
  const tokens = new Map(); // token -> chatId
  const byChat = new Map(); // chatId -> token
  let server = null,
    starting = null,
    port = 0;
  const lead = (chatId) => {
    const chat = ctx.store.state.chats.find((c) => c.id === chatId);
    if (chat?.questRole !== 'lead' || !chat.questId) return null;
    return ctx.store.state.quests.some((q) => q.id === chat.questId) ? chat : null;
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
    return found && lead(found);
  }
  async function call(chat, name, args) {
    const handler = handlers(getEngine())[name];
    const def = TOOLS.find((t) => t[0] === name);
    if (!handler || !def) throw Object.assign(new Error('Ferramenta desconhecida: ' + name), { userSafe: true });
    // Only the declared arguments get through: nothing the model sends can overwrite the quest id the token fixed.
    const given = args && typeof args === 'object' ? args : {};
    const clean = Object.fromEntries(Object.entries(given).filter(([k]) => k in def[2].properties));
    return handler(chat.questId, clean);
  }
  function buildServer(chat) {
    const s = new Server({ name: NAME, version: '1.0.0' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS.map(([name, description, inputSchema]) => ({ name, description, inputSchema })),
    }));
    s.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      try {
        // The chat may have been deleted since the request was authenticated.
        if (!lead(chat.id)) throw Object.assign(new Error('O chat da quest não existe mais'), { userSafe: true });
        const result = await call(chat, params.name, params.arguments);
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
    const chat = authenticate(req);
    if (!chat) return reply(res, 401, { error: 'unauthorized' });
    if (req.method !== 'POST') return reply(res, 405, { error: 'method not allowed' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return reply(res, 400, { error: 'invalid json' });
    }
    // Stateless: a server and transport per request, bound to the chat that owns the token.
    const mcp = buildServer(chat);
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
    NAME,
    // Address and credential for a quest chat; null for any other chat. Starts the server on first use.
    async endpointFor(chat) {
      if (!lead(chat?.id)) return null;
      await start();
      let token = byChat.get(chat.id);
      if (!token) {
        token = randomBytes(24).toString('hex');
        byChat.set(chat.id, token);
        tokens.set(token, chat.id);
      }
      return { name: NAME, url: 'http://127.0.0.1:' + port, mcp: 'http://127.0.0.1:' + port + '/mcp', token };
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
module.exports = { createQuestMcp, TOOLS, NAME };
