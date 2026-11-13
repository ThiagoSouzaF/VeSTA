// How VeSTA names itself and its sessions to the AI Memory server: producer, agent names, stable ingest keys, scope.
const { createHash } = require('node:crypto');
const scope = (projectId) => ({ workspace: 'vesta', project: projectId || 'inbox' });
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
module.exports = { PRODUCER, CANONICAL, AGENTS, agentName, ingestKey, batchItem, scope };
