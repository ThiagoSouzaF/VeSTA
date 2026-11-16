// Stand-in for `gemini --acp` in the driver tests: answers the ACP requests VeSTA sends.
// FAKE_GEMINI=normal (default): a turn with text, one tool call that needs permission and the usage at the end.
//   session/load of "old-session" replays an old message first (it must not reach the chat); other ids fail.
// FAKE_GEMINI=auth: session/new fails as the real CLI does without a login.
// The permission answer is echoed in the text ("permissão: <optionId|cancelled>"); argv is echoed too.
const mode = process.env.FAKE_GEMINI || 'normal';
let buf = '';
let seq = 1000;
const waiting = new Map();
const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
const update = (sessionId, u) => send({ method: 'session/update', params: { sessionId, update: u } });
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    send({ id, method, params });
  });

async function handle(m) {
  if (m.id != null && !m.method) return waiting.get(m.id)?.(m);
  const p = m.params || {};
  if (m.method === 'initialize')
    return send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  if (m.method === 'session/new') {
    if (mode === 'auth')
      return send({ id: m.id, error: { code: -32000, message: 'Gemini API key is missing or not configured.' } });
    return send({ id: m.id, result: { sessionId: 'new-session', mcp: p.mcpServers } });
  }
  if (m.method === 'session/load') {
    if (p.sessionId !== 'old-session') return send({ id: m.id, error: { code: -32000, message: 'session not found' } });
    update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'RESPOSTA ANTIGA' } });
    return send({ id: m.id, result: {} });
  }
  if (m.method === 'session/prompt') {
    const sid = p.sessionId;
    const said = p.prompt.map((b) => b.text).join(' ');
    update(sid, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Olá! Recebi: ' + said + '. ' },
    });
    update(sid, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'pensando' } });
    const toolCall = {
      toolCallId: 'tc1',
      title: 'mkdir pasta-nova',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'mkdir pasta-nova' },
    };
    update(sid, { sessionUpdate: 'tool_call', ...toolCall });
    const r = await ask('session/request_permission', {
      sessionId: sid,
      toolCall,
      options: [
        { optionId: 'proceed_once', name: 'Allow', kind: 'allow_once' },
        { optionId: 'proceed_always', name: 'Always', kind: 'allow_always' },
        { optionId: 'cancel', name: 'Reject', kind: 'reject_once' },
      ],
    });
    const o = r.result?.outcome || {};
    update(sid, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc1',
      status: o.optionId === 'proceed_once' ? 'completed' : 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'saída do comando' } }],
    });
    update(sid, {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc2',
      title: 'memory_write_page (vesta-memory MCP Server)',
      kind: 'other',
      status: 'completed',
      rawInput: { path: 'notas/x.md', body: 'b' },
    });
    update(sid, {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: 'permissão: ' + (o.optionId || o.outcome) + ' argv: ' + process.argv.slice(2).join(' '),
      },
    });
    return send({
      id: m.id,
      result: {
        stopReason: 'end_turn',
        usage: { inputTokens: 120, outputTokens: 30, thoughtTokens: 5, cachedReadTokens: 40 },
      },
    });
  }
  if (m.id != null) send({ id: m.id, error: { code: -32601, message: 'unknown ' + m.method } });
}
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (l.trim()) handle(JSON.parse(l));
  }
});
process.stdin.on('end', () => process.exit(0));
