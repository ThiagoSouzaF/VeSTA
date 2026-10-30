// OpenCode driver: `opencode serve` (HTTP + SSE events), with permission requests routed to ctx.ask.
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { kill } = require('../../util/proc.cjs');
const { clip, tail, lastLine } = require('../../util/text.cjs');
const { freePort } = require('../../util/sys.cjs');
const A = require('../../attachments/rules.cjs');
const { json } = require('./ndjson.cjs');

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
    child.stderr.on('data', (b) => (stderr = tail(stderr, b, 6000)));
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
        reject(new Error(lastLine(stderr) || 'O OpenCode encerrou ao iniciar'));
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
    const opencodeParts = () => {
      try {
        return A.opencodeParts(ctx.prompt, ctx.attachments);
      } catch {
        return [{ type: 'text', text: ctx.prompt }];
      }
    };
    const reader = events.body.getReader(),
      decoder = new TextDecoder();
    await api('POST', '/session/' + sessionId + '/prompt_async', {
      parts: opencodeParts(),
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
      stderr = tail(stderr, '\n' + err.message, 6000);
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
module.exports = { runOpenCode };
