// Codex driver: `codex app-server` over JSON-RPC, with approval requests routed to ctx.ask.
const { spawn } = require('node:child_process');
const { kill } = require('../../util/proc.cjs');
const { clip, tail } = require('../../util/text.cjs');
const A = require('../../attachments/rules.cjs');
const { lines, json } = require('./ndjson.cjs');

// Codex and OpenCode have no equivalent of Claude's "following": their app-server / HTTP server expose no notification
// when a command started in the background ends (checked in the Codex app-server schema: only output deltas and
// terminal interaction of commands that belong to a running turn), so nothing could start the next turn. Both are
// closed when the turn ends, as before; a detached command finishes unseen and the user asks again.
function runCodex(spec, ctx) {
  const child = spawn(spec.exe, spec.args, {
    cwd: ctx.cwd,
    env: ctx.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '',
    seq = 0,
    threadId = null,
    finished = false,
    ended = false;
  const pending = new Map(),
    files = new Map();
  child.stdin.on('error', () => {});
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (b) => (stderr = tail(stderr, b, 6000)));
  const send = (o) => {
    if (child.stdin.writable) child.stdin.write(JSON.stringify(o) + '\n');
  };
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, params });
    });
  // The app-server keeps running after the turn: it is closed once the turn completes.
  const end = () => {
    if (ended) return;
    ended = true;
    child.stdin.end();
    setTimeout(() => kill(child), 1500);
  };
  const serverRequest = async (m) => {
    const p = m.params || {},
      reply = (result) => send({ jsonrpc: '2.0', id: m.id, result });
    const subagent = ctx.parse.ownerOfThread(p.threadId) || '';
    if (m.method === 'item/commandExecution/requestApproval') {
      const a = await ctx.ask({
        provider: 'codex',
        tool: 'command',
        title: p.reason || 'Executar um comando',
        command: p.command || '',
        detail: p.cwd ? 'Pasta: ' + p.cwd : '',
        subagent,
      });
      return reply({ decision: a.allow ? 'accept' : 'decline' });
    }
    if (m.method === 'item/fileChange/requestApproval') {
      const a = await ctx.ask({
        provider: 'codex',
        tool: 'edit',
        title: p.reason || 'Alterar arquivos',
        detail: files.get(p.itemId) || p.grantRoot || '',
        subagent,
      });
      return reply({ decision: a.allow ? 'accept' : 'decline' });
    }
    if (m.method === 'item/permissions/requestApproval') {
      const want = p.permissions || {};
      const a = await ctx.ask({
        provider: 'codex',
        tool: 'permissions',
        title: p.reason || 'Ampliar as permissões do sandbox',
        detail: clip(JSON.stringify(want), 1500),
        subagent,
      });
      return reply({
        permissions: a.allow ? Object.fromEntries(Object.entries(want).filter(([, v]) => v)) : {},
        scope: 'turn',
      });
    }
    if (m.method === 'mcpServer/elicitation/request') {
      const a = await ctx.ask({
        provider: 'codex',
        tool: 'mcp',
        title: p.message || 'Uma ferramenta MCP pede confirmação',
        detail: [p.serverName, p.toolName].filter(Boolean).join(' · '),
        subagent,
      });
      return reply({ action: a.allow ? 'accept' : 'decline', content: a.allow ? {} : null, _meta: null });
    }
    if (m.method === 'item/tool/requestUserInput') return reply({ answers: {} });
    send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Não suportado pelo VeSTA: ' + m.method } });
  };
  lines(child.stdout, (l) => {
    const m = json(l);
    if (!m) return;
    if (m.id != null && !m.method) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) m.error ? p.reject(new Error(m.error.message || 'Erro do Codex')) : p.resolve(m.result);
      return;
    }
    if (m.id != null && m.method) {
      serverRequest(m).catch(() => {});
      return;
    }
    if (m.method === 'item/started' && m.params?.item?.type === 'fileChange')
      files.set(m.params.item.id, (m.params.item.changes || []).map((c) => c.path).join(', '));
    ctx.parse.accept(m);
    if (m.method === 'turn/completed' && m.params?.threadId === threadId) {
      finished = true;
      end();
    }
  });
  (async () => {
    await request('initialize', {
      clientInfo: { name: 'vesta', title: 'VeSTA', version: ctx.version || '0' },
      capabilities: null,
    });
    send({ jsonrpc: '2.0', method: 'initialized' });
    // The plan's usage windows, without waiting for the first turn; later changes arrive as notifications.
    request('account/rateLimits/read')
      .then((r) => ctx.parse.accept({ method: 'account/rateLimits/read', params: r }))
      .catch(() => {});
    const params = { cwd: ctx.cwd, ...spec.thread };
    let started = null;
    if (spec.resume) {
      try {
        started = await request('thread/resume', { threadId: spec.resume, ...params });
      } catch {
        started = null;
      }
    }
    // A thread Codex no longer has (deleted, other machine) starts over instead of failing the message.
    if (!started) started = await request('thread/start', params);
    threadId = started.thread.id;
    ctx.parse.setMainThread(threadId);
    ctx.parse.accept({ method: 'thread/started', params: { thread: { id: threadId } } });
    await request('turn/start', { threadId, input: A.codexInput(ctx.prompt, ctx.attachments) });
  })().catch((err) => {
    ctx.parse.accept({ method: 'error', params: { error: { message: err.message || String(err) } } });
    end();
  });
  const done = new Promise((resolve) => {
    child.on('error', (err) => resolve({ code: -1, stderr: err.message }));
    child.on('close', (code) => resolve({ code: finished ? 0 : (code ?? 1), stderr }));
  });
  return {
    done,
    stop() {
      if (threadId) send({ jsonrpc: '2.0', id: ++seq, method: 'turn/interrupt', params: { threadId } });
      end();
      setTimeout(() => kill(child), 300);
    },
  };
}
module.exports = { runCodex };
