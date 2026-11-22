// Agent Mode screen logic (pure): the state each agent shows, the words for times, today's timeline and the filters.
// The rules themselves (schedule, next run) live in electron/shared/agents.cjs, shared with the main process.
import shared from '../../electron/shared/agents.cjs';

export const { describeSchedule, nextRun, normalizeSchedule, isRunning, lastRun, DAY, INTERVALS } = shared;

const HOUR = 3600000;

// What a card shows first: running (and, inside it, waiting for the person's approval), the last result, or off.
export function statusOf(agent, chats = []) {
  const last = lastRun(agent);
  if (last?.status === 'running') {
    const chat = chats.find((c) => c.id === last.chatId);
    const reply = chat && [...chat.messages].reverse().find((m) => m.role === 'assistant');
    if (reply?.permissions?.some((p) => p.status === 'pending')) return 'waiting';
    return 'running';
  }
  if (!agent.enabled) return 'off';
  if (!last) return 'new';
  return last.status === 'ok' ? 'ok' : 'error';
}
export const STATUS = {
  running: 'rodando',
  waiting: 'esperando você',
  ok: 'ok',
  error: 'falhou',
  off: 'inativo',
  new: 'nunca rodou',
};
export const TRIGGER = { schedule: 'agenda', manual: 'você pediu', 'catch-up': 'ao abrir' };

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const hhmm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
// "hoje 08:30", "amanhã 08:30", "sex 09:00", "24/11 09:00"
export function whenLabel(t, now = Date.now()) {
  if (!t) return '';
  if (sameDay(t, now)) return 'hoje ' + hhmm(t);
  if (sameDay(t, now + 24 * HOUR)) return 'amanhã ' + hhmm(t);
  if (sameDay(t, now - 24 * HOUR)) return 'ontem ' + hhmm(t);
  if (Math.abs(t - now) < 6 * 24 * HOUR) return DAY[new Date(t).getDay()] + ' ' + hhmm(t);
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hhmm(t);
}
// "agora", "em 25 min", "em 3 h", or the day when it is further
export function untilLabel(t, now = Date.now()) {
  if (!t) return '';
  const d = t - now;
  if (d < 60000) return 'agora';
  if (d < HOUR) return 'em ' + Math.round(d / 60000) + ' min';
  if (d < 12 * HOUR) return 'em ' + Math.round(d / HOUR) + ' h';
  return whenLabel(t, now);
}
// "há 5 min", "há 2 h", "ontem 08:30"...
export function agoLabel(t, now = Date.now()) {
  if (!t) return '';
  const d = now - t;
  if (d < 60000) return 'agora há pouco';
  if (d < HOUR) return 'há ' + Math.round(d / 60000) + ' min';
  if (d < 12 * HOUR) return 'há ' + Math.round(d / HOUR) + ' h';
  return whenLabel(t, now);
}
export const duration = (run) => {
  if (!run.endedAt) return '';
  const s = Math.round((run.endedAt - run.at) / 1000);
  return s < 60 ? s + ' s' : Math.round(s / 60) + ' min';
};

// Today on a 24 h line, per agent: the runs that already happened and the times still planned.
// -> { start, end, nowPct, rows: [{ agent, marks: [{ pct, kind: run status | 'planned', t, run? }] }] }
export function todayTimeline(agents, now = Date.now()) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const start = day.getTime(),
    end = start + 24 * HOUR;
  const pct = (t) => ((t - start) / (end - start)) * 100;
  const rows = agents.map((agent) => {
    const marks = (agent.runs || [])
      .filter((r) => r.at >= start && r.at < end)
      .map((r) => ({ pct: pct(r.at), kind: r.status, t: r.at, run: r }));
    if (agent.enabled && agent.schedule?.kind !== 'manual') {
      let t = agent.nextRunAt || nextRun(agent.schedule, now);
      for (let i = 0; t && t < end && i < 24; i++) {
        if (t >= now) marks.push({ pct: pct(t), kind: 'planned', t });
        t = nextRun(agent.schedule, t);
      }
    }
    return { agent, marks: marks.sort((a, b) => a.t - b.t) };
  });
  return { start, end, nowPct: pct(now), rows };
}

// The next agent to run, among the enabled ones.
export function nextUp(agents) {
  return agents.filter((a) => a.enabled && a.nextRunAt).sort((a, b) => a.nextRunAt - b.nextRunAt)[0];
}

export const FILTERS = [
  ['all', 'Todos'],
  ['on', 'Ativos'],
  ['off', 'Inativos'],
];
export function filterAgents(agents, { filter = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return agents.filter(
    (a) =>
      (filter === 'all' || (filter === 'on' ? a.enabled : !a.enabled)) &&
      (!q || (a.name + ' ' + a.prompt).toLowerCase().includes(q))
  );
}

// Starting points for the first agent (the person edits everything before saving).
export const TEMPLATES = [
  {
    name: 'Bom dia do projeto',
    prompt:
      'Leia os commits e as mudanças de ontem e o que ficou pendente na memória deste projeto. Me dê um resumo de até 5 linhas com o que fazer primeiro hoje.',
    schedule: { kind: 'weekdays', time: '08:30' },
    mode: 'read',
  },
  {
    name: 'Testes de toda noite',
    prompt:
      'Rode os testes do projeto. Se algo falhar, investigue a causa sem mudar código e me diga o arquivo, o motivo provável e a correção sugerida.',
    schedule: { kind: 'daily', time: '22:00' },
    mode: 'ask',
  },
  {
    name: 'Faxina da memória',
    prompt:
      'Procure na memória páginas repetidas, vencidas ou que se contradizem. Liste o que unir ou apagar, com o motivo de cada uma. Não apague nada.',
    schedule: { kind: 'weekly', time: '20:00', days: [0] },
    mode: 'read',
  },
];
