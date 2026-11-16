// Gemini driver: `gemini --acp` (Agent Client Protocol, JSON-RPC over stdio). One turn = initialize, then
// session/load (the chat's session) or session/new, then session/prompt, which answers only when the turn ends.
// The agent's permission requests (session/request_permission) go to ctx.ask; in "read" mode they are refused
// without asking: only reading needs no permission in Gemini's default mode.
const { spawn } = require('node:child_process');
const { kill } = require('../../util/proc.cjs');
const { clip, tail } = require('../../util/text.cjs');
const { lines, json } = require('./ndjson.cjs');

// Every request but the prompt answers at once; one that does not is a stuck CLI.
const REQUEST_TIMEOUT_MS = 120000;
const LOGIN_HINT = 'Configure o Gemini: crie uma chave em aistudio.google.com/apikey e salve em Conexões → Gemini.';
// Google refuses personal accounts that log in to the CLI with Google (IneligibleTierError): only a key works.
const BLOCKED_LOGIN_HINT =
  'O Google não aceita mais o login pessoal do Google no Gemini CLI. Crie uma chave em aistudio.google.com/apikey e salve em Conexões → Gemini.';
// Quota (429: the free tier gives some models a limit of 0) and a busy model (503) say what to do instead.
const QUOTA_HINT =
  'Este modelo não está no plano gratuito da sua chave do Gemini ou o limite de uso acabou. Escolha o Gemini 3.1 Flash-Lite ou ative o faturamento no Google AI Studio.';
const BUSY_HINT =
  'O Google está com o modelo sobrecarregado agora. Tente de novo em instantes ou escolha outro modelo do Gemini.';
// The model Google names in the error, so the person knows which one to switch away from.
const modelOf = (message) => {
  const m = /model: ([\w.-]+)/.exec(message);
  return m ? ' (modelo: ' + m[1] + ')' : '';
};
const hintFor = (message) =>
  /no longer supported|IneligibleTier|antigravity/i.test(message)
    ? BLOCKED_LOGIN_HINT
    : /quota|RESOURCE_EXHAUSTED|\b429\b|rate limit/i.test(message)
      ? QUOTA_HINT + modelOf(message)
      : /high demand|overloaded|UNAVAILABLE|\b503\b/i.test(message)
        ? BUSY_HINT
        : /api key|auth|login|credential/i.test(message)
          ? LOGIN_HINT + ' (' + message + ')'
          : message;

// What a tool call is about, for the permission card: the command, the file(s) or the title.
function describe(tc = {}) {
  const input = tc.rawInput || {};
  const files = (tc.locations || []).map((l) => l.path).filter(Boolean);
  return {
    command: input.command ? String(input.command) : '',
    detail: files.length ? files.join(', ') : input.file_path || input.dir_path || input.url || '',
  };
}
const TOOL_OF_KIND = { execute: 'command', edit: 'edit', delete: 'edit', move: 'edit', fetch: 'web' };

function runGemini(spec, ctx) {
  const child = spawn(spec.exe, spec.args, {
    cwd: ctx.cwd,
    env: ctx.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '',
    seq = 0,
    sessionId = null,
    prompting = false,
    finished = false,
    ended = false;
  const pending = new Map();
  child.stdin.on('error', () => {});
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (b) => (stderr = tail(stderr, b, 6000)));
  const send = (o) => {
    if (child.stdin.writable) child.stdin.write(JSON.stringify(o) + '\n');
  };
  const request = (method, params, timeoutMs = ctx.requestTimeoutMs ?? REQUEST_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = timeoutMs
        ? setTimeout(() => {
            pending.delete(id);
            reject(new Error('O Gemini não respondeu a ' + method + ' a tempo'));
          }, timeoutMs)
        : null;
      timer?.unref?.();
      pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      send({ jsonrpc: '2.0', id, method, params });
    });
  const failPending = (why) => {
    for (const p of pending.values()) p.reject(new Error(why));
    pending.clear();
  };
  const end = () => {
    if (ended) return;
    ended = true;
    child.stdin.end();
    setTimeout(() => kill(child), 1500);
  };
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  async function permission(m) {
    const p = m.params || {},
      tc = p.toolCall || {},
      options = p.options || [];
    const pick = (kind) => options.find((o) => o.kind === kind)?.optionId;
    const answer = (allow) => {
      const optionId = allow ? pick('allow_once') : pick('reject_once');
      reply(m.id, { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } });
    };
    if (spec.readOnly) return answer(false);
    const { command, detail } = describe(tc);
    const a = await ctx.ask({
      provider: 'gemini',
      tool: TOOL_OF_KIND[tc.kind] || 'tool',
      title: clip(tc.title || 'Usar uma ferramenta', 300),
      command,
      detail: clip(detail, 1500),
    });
    answer(a.allow);
  }
  lines(child.stdout, (l) => {
    const m = json(l);
    if (!m) return;
    if (m.id != null && !m.method) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) m.error ? p.reject(new Error(m.error.message || 'Erro do Gemini')) : p.resolve(m.result);
      return;
    }
    if (m.id != null && m.method) {
      if (m.method === 'session/request_permission') permission(m).catch(() => {});
      // VeSTA declares no file system or terminal of its own: the CLI uses the disk itself.
      else
        send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Não suportado pelo VeSTA: ' + m.method } });
      return;
    }
    // session/load replays the old conversation as updates: only this turn's updates go to the chat.
    if (m.method === 'session/update' && prompting) ctx.parse.accept(m.params?.update || {});
  });
  (async () => {
    await request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'vesta', title: 'VeSTA', version: ctx.version || '0' },
    });
    const params = { cwd: ctx.cwd, mcpServers: spec.mcpServers || [] };
    if (spec.resume)
      try {
        await request('session/load', { sessionId: spec.resume, ...params });
        sessionId = spec.resume;
      } catch {}
    // A session the CLI no longer has (deleted, other machine) starts over instead of failing the message.
    if (!sessionId) sessionId = (await request('session/new', params)).sessionId;
    ctx.parse.accept({ sessionUpdate: 'session', sessionId });
    prompting = true;
    // Attachments go as paths in the text (attachments/rules.cjs); the folder is in --include-directories.
    const result = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: ctx.prompt }] }, 0);
    ctx.parse.accept({ sessionUpdate: 'prompt_result', ...result });
    finished = result?.stopReason !== 'cancelled' && result?.stopReason !== 'refusal';
    end();
  })().catch((err) => {
    ctx.parse.accept({ sessionUpdate: 'error', message: hintFor(err.message || String(err)) });
    end();
  });
  const done = new Promise((resolve) => {
    child.on('error', (err) => {
      failPending(err.message);
      resolve({ code: -1, stderr: err.message });
    });
    child.on('close', (code) => {
      failPending('O Gemini encerrou');
      resolve({ code: finished ? 0 : (code ?? 1) || 1, stderr });
    });
  });
  return {
    done,
    stop() {
      if (sessionId) send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
      setTimeout(end, 500);
      setTimeout(() => kill(child), 2500);
    },
  };
}
module.exports = { runGemini, LOGIN_HINT, BLOCKED_LOGIN_HINT, QUOTA_HINT, BUSY_HINT, hintFor };
