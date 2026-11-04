// Chats as AI Memory sessions. The VeSTA plays the role of the native hooks for every AI (no hook is installed in
// ~/.claude or ~/.codex): it posts the lifecycle of each conversation stretch to the server it already runs, and when
// the stretch ends (30 min idle, AI or project switched, app reopened) it asks the server to consolidate it with an LLM
// into session / rule / gotcha / concept pages. See docs/memoria-consolidacao.md.
//
// chat.memorySession = { id (UUID, kept by the server), provider, projectId, startedAt, lastAt, turns }
// state.memoryPending = [{ session, chatId, reason, ended, attempts }]  closed stretches still to end/consolidate:
//   persisted, so a failure (server down, Codex logged out, quota) is retried on the next close or app start.
const { randomUUID } = require('node:crypto');
const { redact } = require('./redact.cjs');
const { agentName: agentOf } = require('./protocol.cjs');
const { sleep } = require('../util/sys.cjs');
const { ellipsis: clip } = require('../util/text.cjs');

const IDLE_MS = 30 * 60 * 1000;
const MAX_TOOLS = 30;
const MAX_ATTEMPTS = 3;
// Assistant capture (#196) exists for Claude Code and Codex only; the other AIs report a plain stop.
const answersCaptured = (provider) => provider === 'claude' || provider === 'codex';
// Consolidation reply -> notes mirrored in the Memória screen.
function notesFrom(reply, { projectId, chatId, now }) {
  let outcomes = [];
  try {
    outcomes = JSON.parse(reply).outcomes || [];
  } catch {
    return [];
  }
  return outcomes
    .filter((o) => o && o.path && !o.dry_run)
    .map((o) => ({
      id: randomUUID(),
      path: String(o.path),
      title: clip(redact(o.new_title || o.path), 200),
      kind: String(o.path).startsWith('sessions/') ? 'session' : 'insight',
      projectId: projectId || null,
      chatId,
      body: clip(redact(o.new_body_markdown || ''), 12000),
      createdAt: now,
    }));
}

function createMemorySessions(ctx, deps = {}) {
  const now = deps.now || Date.now;
  const idleMs = deps.idleMs ?? IDLE_MS;
  // Lets the server write the queued session-end (it answers 202) before the consolidation reads the session.
  const settleMs = deps.settleMs ?? 1500;
  const timers = new Map();
  const queues = new Map();
  const waiters = new Map(); // session id -> callbacks of end() promises
  const status = { lastError: null, lastConsolidation: null };
  let draining = null;
  const store = () => ctx.store;
  const state = () => ctx.store.state;
  const settings = () => state().settings;
  const pending = () => (state().memoryPending ||= []);
  const chatOf = (id) => state().chats.find((c) => c.id === id);
  const enabled = (chat) => !!(settings().memoryEnabled && settings().capture !== false && chat?.memory);
  const consolidating = () => settings().memoryConsolidate === 'codex';
  const commit = () => {
    store().save();
    ctx.sync?.();
  };
  const fail = (e) => {
    status.lastError = { at: now(), message: clip(redact(e?.message || String(e)), 300) };
  };
  // Events of one chat keep their order; a failure is recorded and does not block the next ones.
  const chain = (chatId, work) => {
    const next = (queues.get(chatId) || Promise.resolve()).then(work);
    const settled = next.catch(fail);
    queues.set(chatId, settled);
    settled.then(() => queues.get(chatId) === settled && queues.delete(chatId));
    return next;
  };
  const cwdOf = (chat) => {
    try {
      return chat ? ctx.workdir(chat) : '';
    } catch {
      return '';
    }
  };
  // Stable identity of each event (never derived from its content): start/end are unique per session, the others count.
  const eventIdOf = (s, event) =>
    event === 'session-start' || event === 'session-end' ? event : (s.seq = (s.seq || 0) + 1);
  const post = (chat, s, event, extra) =>
    ctx.memory.hook(
      event,
      agentOf(s.provider),
      { session_id: s.id, cwd: cwdOf(chat), ...extra },
      s.projectId,
      eventIdOf(s, event)
    );
  const disarm = (chatId) => {
    clearTimeout(timers.get(chatId));
    timers.delete(chatId);
  };
  const arm = (chat) => {
    disarm(chat.id);
    const t = setTimeout(() => {
      timers.delete(chat.id);
      end(chat.id, 'idle').catch(() => {});
    }, idleMs);
    t.unref?.();
    timers.set(chat.id, t);
  };
  const settle = (item, err, notes) => {
    const w = waiters.get(item.session.id);
    waiters.delete(item.session.id);
    if (w) err ? w.reject(err) : w.resolve(notes);
  };

  async function consolidate(s, chatId) {
    const reply = await ctx.memory.call(
      'memory_consolidate',
      { session_id: s.id, multi_page: true },
      { timeout: 180000 }
    );
    const notes = notesFrom(reply, { projectId: s.projectId, chatId, now: now() });
    // The chat was deleted while the LLM worked: its content must not outlive it.
    if (!chatOf(chatId)) {
      for (const n of notes)
        await ctx.memory.call('memory_delete_page', { path: n.path, ...scopeOf(s) }).catch(() => {});
      return [];
    }
    const key = (n) => (n.projectId || '') + '|' + n.path;
    const fresh = new Set(notes.map(key));
    state().memories = [...notes, ...state().memories.filter((n) => !fresh.has(key(n)))];
    status.lastConsolidation = { at: now(), pages: notes.length, chatId };
    commit();
    return notes;
  }
  const scopeOf = (s) => ({ workspace: 'vesta', project: s.projectId || 'inbox' });

  // One closed stretch: session-end (once), then the consolidation when it is on, the stretch had a finished turn and
  // the chat still exists. Throws to keep the item for a later retry.
  async function handle(item) {
    const s = item.session,
      chat = chatOf(item.chatId);
    if (!item.ended) {
      await post(chat, s, 'session-end', { reason: item.reason });
      item.ended = true;
      commit();
      if (settleMs) await sleep(settleMs);
    }
    if (!chat || !consolidating() || !s.turns) return [];
    return consolidate(s, item.chatId);
  }
  // Closed stretches are handled one at a time (one LLM call at a time), in order. Failed ones stay for the next run.
  function drain() {
    if (draining) return draining;
    draining = (async () => {
      const tried = new Set();
      for (;;) {
        const item = pending().find((i) => !tried.has(i.session.id));
        if (!item) break;
        tried.add(item.session.id);
        try {
          const notes = await handle(item);
          state().memoryPending = pending().filter((i) => i !== item);
          commit();
          settle(item, null, notes);
        } catch (e) {
          fail(e);
          item.attempts = (item.attempts || 0) + 1;
          if (item.attempts >= MAX_ATTEMPTS) state().memoryPending = pending().filter((i) => i !== item);
          commit();
          settle(item, e);
        }
      }
    })().finally(() => {
      draining = null;
    });
    return draining;
  }

  // Closes the open stretch of a chat (if any) and consolidates it. Resolves when the consolidation is done.
  // Only the close is queued with the chat's events: a new message never waits for the (slow) consolidation.
  function end(chatId, reason = 'exit') {
    const closed = chain(chatId, async () => {
      const chat = chatOf(chatId);
      const s = chat?.memorySession;
      disarm(chatId);
      if (!s) return null;
      delete chat.memorySession;
      pending().push({ session: s, chatId, reason, ended: false, attempts: 0 });
      commit();
      return s;
    });
    return closed.then((s) => {
      if (!s) return [];
      const done = new Promise((resolve, reject) => waiters.set(s.id, { resolve, reject }));
      drain();
      return done;
    });
  }

  return {
    status,
    agentOf,
    // Before the AI runs: opens a stretch when needed and records the prompt. The caller does not wait for it.
    turnStart(chat, text) {
      if (!enabled(chat)) return Promise.resolve();
      const s = chat.memorySession;
      // Another AI or project: the old stretch is closed (and consolidated) on its own.
      if (s && (s.provider !== chat.provider || (s.projectId || null) !== (chat.projectId || null)))
        end(chat.id, 'switch').catch(() => {});
      return chain(chat.id, async () => {
        disarm(chat.id);
        let cur = chat.memorySession;
        if (!cur) {
          cur = chat.memorySession = {
            id: randomUUID(),
            provider: chat.provider,
            projectId: chat.projectId || null,
            startedAt: now(),
            lastAt: now(),
            turns: 0,
          };
          commit();
          await post(chat, cur, 'session-start', { source: 'startup' });
        }
        await post(chat, cur, 'user-prompt', { prompt: clip(redact(text), 8000) });
      });
    },
    // After the AI answered (or failed): tools it used, then its answer (a sanitized 2 KB excerpt kept by the local
    // server), and the idle timer restarts even when an event could not be delivered.
    turnEnd(chat, assistant) {
      if (!chat.memorySession) return Promise.resolve();
      if (!enabled(chat)) return end(chat.id, 'disabled').catch(() => {});
      return chain(chat.id, async () => {
        const s = chat.memorySession;
        if (!s || !chatOf(chat.id)) return;
        try {
          const tools = (assistant.activities || []).filter((a) => a.kind !== 'memory').slice(-MAX_TOOLS);
          for (const a of tools)
            await post(chat, s, 'post-tool-use', {
              tool_name: clip(redact(a.label || 'ferramenta'), 80),
              tool_input: { detail: clip(redact(a.detail || ''), 600) },
              tool_response: { status: a.status || 'done' },
            });
          const answer = assistant.status === 'done' ? clip(redact(assistant.text || ''), 8000) : '';
          if (answer && answersCaptured(s.provider))
            await ctx.memory.stopWithAnswer(agentOf(s.provider), {
              session_id: s.id,
              cwd: cwdOf(chat),
              hook_event_name: 'Stop',
              last_assistant_message: answer,
            });
          else await post(chat, s, 'stop', answer ? { last_assistant_message: answer } : {});
        } finally {
          if (assistant.status === 'done') s.turns += 1;
          s.lastAt = now();
          commit();
          arm(chat);
        }
      });
    },
    end,
    // The chat moved to another AI: leaves a short cross-agent handoff in the shared memory (the next AI also gets the
    // history in its prompt; this one is what a harness with its own session start would find).
    handoffOnSwitch(chat, from) {
      if (!enabled(chat) || !ctx.memory.handoff) return Promise.resolve();
      const last = (role) => [...chat.messages].reverse().find((m) => m.role === role && m.text)?.text || '';
      const summary =
        'A conversa "' +
        clip(chat.title, 80) +
        '" passou de ' +
        from +
        ' para ' +
        chat.provider +
        '. Último pedido do usuário: ' +
        clip(last('user'), 300) +
        ' Última resposta: ' +
        clip(last('assistant'), 500);
      return ctx.memory
        .handoff({
          projectId: chat.projectId,
          summary,
          nextSteps: ['Continuar a conversa "' + clip(chat.title, 80) + '" de onde a IA anterior parou.'],
          cwd: cwdOf(chat),
        })
        .catch(fail);
    },
    // The chat moved to another project: its open stretch is closed (and consolidated) in the old project, and the new
    // one gets a handoff, so an AI opening it finds where the conversation stands.
    handoffOnMove(chat, fromName) {
      const closed = end(chat.id, 'project-moved').catch(fail);
      if (!enabled(chat) || !ctx.memory.handoff) return closed;
      const last = (role) => [...chat.messages].reverse().find((m) => m.role === role && m.text)?.text || '';
      const summary =
        'A conversa "' +
        clip(chat.title, 80) +
        '" veio do projeto ' +
        (fromName || 'Espaço pessoal') +
        '. Último pedido do usuário: ' +
        clip(last('user'), 300) +
        ' Última resposta: ' +
        clip(last('assistant'), 500);
      const handed = ctx.memory
        .handoff({
          projectId: chat.projectId,
          summary,
          nextSteps: ['Continuar a conversa "' + clip(chat.title, 80) + '" neste projeto.'],
          cwd: cwdOf(chat),
        })
        .catch(fail);
      return Promise.all([closed, handed]);
    },
    // A deleted chat is not consolidated (its content should not outlive it): the timer goes away, its open stretch is
    // closed on the server without an LLM pass, and its pending consolidations end without one (the chat is gone).
    forget(chatId, session) {
      disarm(chatId);
      if (session) pending().push({ session: { ...session, turns: 0 }, chatId, reason: 'deleted', ended: false });
      commit();
      drain();
    },
    // App (re)opened: stretches left open by the previous run (closed app, crash) are closed and consolidated now,
    // together with the ones whose consolidation failed before.
    recover() {
      const open = state().chats.filter((c) => c.memorySession);
      const ends = open.map((c) => end(c.id, 'app-restart'));
      if (!open.length && pending().length) drain();
      return Promise.allSettled(ends);
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
module.exports = { createMemorySessions, notesFrom, agentOf, answersCaptured, IDLE_MS };
