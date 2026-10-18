// One turn of a chat against its CLI. Each driver feeds the provider parser and routes the agent's permission
// requests (its own and its subagents') through ctx.ask, which waits for the user's answer.
// start(spec, ctx) -> {done: Promise<{code, stderr, finished}>, stop()}
//   spec: providers.command(); ctx: {cwd, env, prompt, parse, ask(request) -> Promise<{allow, message}>, version}
const { spawn } = require('node:child_process');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { kill } = require('./providers.cjs');
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
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
// Newline-delimited JSON from a child's stdout.
function lines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (b) => {
    buf += b;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (l.trim()) onLine(l);
    }
    if (buf.length > 2000000) buf = '';
  });
  stream.on('end', () => {
    if (buf.trim()) onLine(buf);
    buf = '';
  });
}
const json = (l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
};
// What a Claude tool call touches, for the permission card.
function claudeDetail(name, input = {}) {
  if (input.file_path || input.notebook_path) return input.file_path || input.notebook_path;
  if (input.url) return input.url;
  if (input.path || input.pattern) return [input.path, input.pattern].filter(Boolean).join(' · ');
  if (input.description) return input.description;
  const keys = Object.keys(input);
  return keys.length ? clip(JSON.stringify(input), 600) : '';
}
const isShell = (name) => /^(bash|powershell|shell)$/i.test(String(name || ''));

function runClaude(spec, ctx) {
  const child = spawn(spec.exe, spec.args, {
    cwd: ctx.cwd,
    env: ctx.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '',
    closed = false;
  child.stdin.on('error', () => {});
  const write = (o) => {
    if (!closed && child.stdin.writable) child.stdin.write(JSON.stringify(o) + '\n');
  };
  // stdin stays open while Claude may still ask for permissions; it closes once the turn has its result
  // and no background subagent is still working (their completion starts another turn).
  const finish = () => {
    if (!closed) {
      closed = true;
      child.stdin.end();
    }
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (b) => (stderr = (stderr + b).slice(-6000)));
  const control = async (e) => {
    const r = e.request || {};
    if (r.subtype !== 'can_use_tool')
      return write({
        type: 'control_response',
        response: { subtype: 'error', request_id: e.request_id, error: 'Não suportado pelo VeSTA: ' + r.subtype },
      });
    const input = r.input || {};
    const answer = await ctx.ask({
      provider: 'claude',
      tool: r.tool_name,
      title: r.description || r.display_name || r.tool_name,
      command: isShell(r.tool_name) ? input.command : '',
      detail: isShell(r.tool_name)
        ? r.blocked_path
          ? 'Caminho: ' + r.blocked_path
          : ''
        : claudeDetail(r.tool_name, input),
      subagent: ctx.parse.ownerOf(r.tool_use_id) || (r.agent_id ? 'subagente' : ''),
    });
    write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: e.request_id,
        response: answer.allow
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: answer.message || 'Negado pelo usuário.' },
      },
    });
  };
  // After the final result Claude may stay alive only to wait for background shell commands it started (a dev
  // server, a watcher) that never end. The turn is over: give it a moment, then end claude.exe alone, never its
  // process tree, so whatever it left running keeps running.
  let settled = false,
    linger = null;
  const settle = () => {
    if (settled) return;
    settled = true;
    finish();
    linger = setTimeout(() => {
      if (child.exitCode === null)
        try {
          child.kill();
        } catch {}
    }, ctx.lingerMs ?? 5000);
  };
  lines(child.stdout, (l) => {
    const e = json(l);
    if (!e) {
      stderr = (stderr + '\n' + l).slice(-6000);
      return;
    }
    if (e.type === 'control_request') {
      control(e).catch(() => {});
      return;
    }
    if (e.type === 'control_response' || e.type === 'control_cancel_request') return;
    ctx.parse.accept(e);
    // On resume, a background task that died with the previous process is delivered first as its own empty
    // turn (num_turns 0, no result text); the answer to this prompt comes after it, so that one must not settle.
    if (e.type === 'result' && !(e.num_turns === 0 && !e.result) && !ctx.parse.backgroundRunning()) settle();
  });
  write({ type: 'user', message: { role: 'user', content: ctx.prompt } });
  const done = new Promise((resolve) => {
    child.on('error', (err) => resolve({ code: -1, stderr: err.message }));
    child.on('close', (code) => {
      clearTimeout(linger);
      resolve({ code: settled ? 0 : code, stderr });
    });
  });
  return {
    done,
    stop() {
      finish();
      kill(child);
    },
  };
}

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
  child.stderr.on('data', (b) => (stderr = (stderr + b).slice(-6000)));
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
    await request('turn/start', { threadId, input: [{ type: 'text', text: ctx.prompt, text_elements: [] }] });
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

function runOpenCode(spec, ctx) {
  let child = null,
    base = '',
    stderr = '',
    finished = false,
    stopped = false,
    sessionId = spec.resume || null;
  const abort = new AbortController(),
    password = randomBytes(18).toString('hex');
  const auth = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
  const api = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    if (!r.ok) throw new Error('OpenCode ' + r.status + ': ' + clip(t, 300));
    try {
      return t ? JSON.parse(t) : null;
    } catch {
      return t;
    }
  };
  const tree = new Set(),
    children = new Map(),
    roles = new Map();
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const close = () => {
    abort.abort();
    if (child) kill(child);
  };
  const handle = async (e) => {
    const t = e.type,
      p = e.properties || {};
    if ((t === 'session.created' || t === 'session.updated') && p.info?.parentID && tree.has(p.info.parentID)) {
      tree.add(p.info.id);
      children.set(p.info.id, p.info.title || 'subagente');
    }
    if (t === 'message.updated' && p.info?.id) roles.set(p.info.id, p.info.role);
    if (t === 'message.part.updated' && p.part?.sessionID === sessionId) {
      // Same shapes `opencode run --format json` printed, so the parser stays the same.
      const part = p.part;
      if (part.type === 'text' && part.time?.end && roles.get(part.messageID) !== 'user' && !part.synthetic)
        ctx.parse.accept({ type: 'text', sessionID: sessionId, part });
      if (part.type === 'tool') ctx.parse.accept({ type: 'tool_use', sessionID: sessionId, part });
      if (part.type === 'step-finish') ctx.parse.accept({ type: 'step_finish', sessionID: sessionId, part });
    }
    if (t === 'permission.asked' && tree.has(p.sessionID)) {
      const meta = p.metadata || {};
      const a = await ctx.ask({
        provider: 'opencode',
        tool: p.permission,
        title:
          p.permission === 'bash'
            ? 'Executar um comando'
            : p.permission === 'edit'
              ? 'Alterar arquivos'
              : 'Usar ' + p.permission,
        command: p.permission === 'bash' ? meta.command || (p.patterns || []).join(' ') : '',
        detail:
          p.permission === 'bash' ? '' : meta.filepath || meta.filePath || meta.url || (p.patterns || []).join(', '),
        subagent: p.sessionID === sessionId ? '' : children.get(p.sessionID) || 'subagente',
      });
      await api(
        'POST',
        '/permission/' + p.id + '/reply',
        a.allow ? { reply: 'once' } : { reply: 'reject', message: a.message || 'Negado pelo usuário.' }
      ).catch(() => {});
    }
    if (t === 'session.error' && p.sessionID === sessionId)
      ctx.parse.accept({ type: 'error', sessionID: sessionId, error: p.error });
    if (t === 'session.idle' && p.sessionID === sessionId) {
      finished = true;
      close();
    }
  };
  (async () => {
    const port = await freePort();
    child = spawn(spec.exe, [...spec.args, '--port', String(port)], {
      cwd: ctx.cwd,
      env: { ...ctx.env, OPENCODE_SERVER_PASSWORD: password },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (b) => (stderr = (stderr + b).slice(-6000)));
    child.on('close', (code) => resolveDone({ code: finished || stopped ? 0 : (code ?? 1), stderr }));
    child.on('error', (err) => resolveDone({ code: -1, stderr: err.message }));
    base = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error('O OpenCode não iniciou o servidor a tempo')), 90000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (b) => {
        out += b;
        const m = /listening on (http:\/\/[^\s]+)/.exec(out);
        if (m) {
          clearTimeout(timer);
          resolve(m[1].replace(/\/$/, ''));
        }
      });
      child.on('close', () => {
        clearTimeout(timer);
        reject(new Error(stderr.trim().split('\n').pop() || 'O OpenCode encerrou ao iniciar'));
      });
    });
    if (sessionId) {
      try {
        await api('GET', '/session/' + sessionId);
      } catch {
        sessionId = null;
      }
    }
    if (!sessionId) sessionId = (await api('POST', '/session', {})).id;
    tree.add(sessionId);
    ctx.parse.accept({ type: 'session', sessionID: sessionId });
    const events = await fetch(base + '/event', {
      headers: { authorization: auth, accept: 'text/event-stream' },
      signal: abort.signal,
    });
    const reader = events.body.getReader(),
      decoder = new TextDecoder();
    await api('POST', '/session/' + sessionId + '/prompt_async', {
      parts: [{ type: 'text', text: ctx.prompt }],
      agent: spec.agent,
      ...(spec.model ? { model: spec.model } : {}),
    });
    let buf = '';
    while (true) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        const e = data && json(data);
        if (e) handle(e).catch(() => {});
      }
    }
  })().catch((err) => {
    if (!abort.signal.aborted) {
      ctx.parse.accept({ type: 'error', error: { message: err.message } });
      stderr = (stderr + '\n' + err.message).slice(-6000);
    }
    close();
    if (!child) resolveDone({ code: -1, stderr: err.message });
  });
  return {
    done,
    stop() {
      stopped = true;
      if (sessionId && base)
        api('POST', '/session/' + sessionId + '/abort')
          .catch(() => {})
          .finally(close);
      else close();
    },
  };
}

function start(provider, spec, ctx) {
  return provider === 'drael'
    ? require('./drael.cjs').start(spec, ctx)
    : provider === 'claude'
      ? runClaude(spec, ctx)
      : provider === 'codex'
        ? runCodex(spec, ctx)
        : runOpenCode(spec, ctx);
}
module.exports = { start, claudeDetail };
