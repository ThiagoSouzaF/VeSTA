// Read-only views the quest chat gets of the step chats (pure: no I/O, no engine state). Used by the vesta-quest MCP
// server through the engine, and by the tests.
const { messageTasks, countTasks, summaryLine, isDetached } = require('../shared/tasks.cjs');

const clip = (v, n) => {
  const s = String(v ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const PAGE_BUDGET = 14000; // characters of message text per page (activities come on top, bounded)
const MAX_LINES = 30;

// One task of a message -> a short line the quest chat can read.
function taskLine(t) {
  const kind = t.kind === 'turn' ? 'resposta' : t.kind;
  return (
    '[' +
    t.status +
    (isDetached(t) ? ', segundo plano' : '') +
    '] ' +
    kind +
    ' · ' +
    clip(t.label, 100) +
    (t.detail ? ' — ' + clip(t.detail.replace(/\s+/g, ' '), 140) : '') +
    (t.kind === 'subagent' && t.extra?.result ? ' => ' + clip(t.extra.result.replace(/\s+/g, ' '), 300) : '')
  );
}
// Activities, subagents and commands of an assistant message, summarized (commands/subagents counts + capped lines).
function activitySummary(chat, m, live) {
  const tasks = messageTasks(chat, m, { live }).filter((t) => t.kind !== 'turn');
  if (!tasks.length) return null;
  const lines = tasks.slice(0, MAX_LINES).map(taskLine);
  if (tasks.length > MAX_LINES) lines.push('… mais ' + (tasks.length - MAX_LINES) + ' itens');
  return { resumo: summaryLine(countTasks(tasks)) || tasks.length + ' atividade(s)', itens: lines };
}

// Page of a chat's history. Cursor = message index (`desde`) + character offset inside that message (`deslocamento`):
// a long answer is split across pages instead of being cut, so the whole conversation is reachable.
function readChat(chat, { desde = 0, deslocamento = 0, limite = 8, live = false, budget = PAGE_BUDGET } = {}) {
  const all = chat.messages || [];
  let i = Math.max(0, Math.min(all.length, Math.floor(Number(desde)) || 0));
  let offset = Math.max(0, Math.floor(Number(deslocamento)) || 0);
  limite = Math.max(1, Math.min(30, Math.floor(Number(limite)) || 8));
  const out = [];
  let used = 0,
    next = null;
  for (; i < all.length && out.length < limite; i++, offset = 0) {
    const m = all[i];
    const full = String(m.text || '');
    const room = Math.max(500, budget - used);
    const slice = full.slice(offset, offset + room);
    const more = offset + slice.length < full.length;
    const item = {
      index: i,
      role: m.role,
      ...(m.role === 'assistant'
        ? { status: m.status || 'done', ia: [m.provider, m.model].filter(Boolean).join(' / ') }
        : {}),
      ...(m.createdAt ? { em: new Date(m.createdAt).toISOString() } : {}),
      texto: slice,
      ...(offset > 0 || more ? { trecho: [offset, offset + slice.length, full.length] } : {}),
      ...(m.error ? { erro: clip(m.error, 600) } : {}),
      ...(m.attachments?.length ? { anexos: m.attachments.map((a) => a.name) } : {}),
    };
    if (m.role === 'assistant' && offset === 0) {
      const act = activitySummary(chat, m, live);
      if (act) item.atividades = act;
    }
    out.push(item);
    used += slice.length;
    if (more) {
      next = { desde: i, deslocamento: offset + slice.length };
      break;
    }
    if (used >= budget) {
      if (i + 1 < all.length) next = { desde: i + 1, deslocamento: 0 };
      i++;
      break;
    }
  }
  if (!next && i < all.length) next = { desde: i, deslocamento: 0 };
  return {
    chatId: chat.id,
    titulo: chat.title,
    ia: [chat.provider, chat.model].filter(Boolean).join(' / '),
    respondendo: !!live,
    total: all.length,
    mensagens: out,
    proximo: next,
  };
}

// Tasks still running in a chat's current/last assistant message (for activity_get).
function runningTasks(chat, live) {
  const m = [...(chat.messages || [])].reverse().find((x) => x.role === 'assistant');
  if (!m) return [];
  return messageTasks(chat, m, { live })
    .filter((t) => t.status === 'running')
    .map((t) => ({
      tipo: t.kind === 'turn' ? 'resposta' : t.kind,
      titulo: clip(t.label, 100),
      detalhe: clip(t.detail, 200),
      desde: t.startedAt ? new Date(t.startedAt).toISOString() : null,
      segundoPlano: isDetached(t),
      taskId: t.taskId || null,
      encerravel: !!t.taskId && t.kind !== 'turn',
    }));
}

module.exports = { readChat, runningTasks, activitySummary, PAGE_BUDGET };
