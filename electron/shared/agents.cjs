// Agents (Agent Mode): a named job an AI does on its own, on a schedule or when the person asks, with the memory and
// the skills of VeSTA. Pure functions, no I/O: used by the engine (main process), the tests and the screen.
//
// Agent { id, name, prompt, provider, model, projectId, mode, memory, skills, schedule, enabled, catchUp, runs[],
//         nextRunAt, unseen, createdAt, updatedAt }
//   mode      'read' (Consulta) | 'ask' (Pedir permissão: each command waits for the person) | 'edit' (Acesso completo)
//   schedule  { kind: 'manual' | 'daily' | 'weekdays' | 'weekly' | 'interval', time: 'HH:MM', days: [0-6], hours }
//   catchUp   a scheduled time missed while VeSTA was closed runs once when it opens
//   unseen    runs that ended since the person last opened Agent Mode (the rail badge)
// Run { id, at, endedAt, trigger: 'schedule' | 'manual' | 'catch-up', status: 'running' | 'ok' | 'error', chatId,
//       summary, error }
// Message meant for the person (this file also runs in the renderer, so it cannot require errors.cjs).
const userError = (message) => Object.assign(new Error(message), { name: 'UserError', userSafe: true });
// The same four AIs as quests.cjs (a shared file cannot require another; a test keeps both lists equal).
const PROVIDER_IDS = ['claude', 'codex', 'opencode', 'drael'];
const MODES = ['read', 'ask', 'edit'];
const KINDS = ['manual', 'daily', 'weekdays', 'weekly', 'interval'];
const INTERVALS = [1, 2, 3, 4, 6, 8, 12];
const MAX_RUNS = 30;
const MAX_NAME = 60;
const MAX_PROMPT = 8000;
const MAX_SUMMARY = 280;
const DAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const HOUR = 3600000;

const clean = (v, max) =>
  String(v == null ? '' : v)
    .trim()
    .slice(0, max);
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));

function normalizeSchedule(s = {}) {
  const kind = KINDS.includes(s.kind) ? s.kind : 'manual';
  const time = validTime(s.time) ? s.time : '08:30';
  const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort();
  const hours = INTERVALS.includes(Number(s.hours)) ? Number(s.hours) : 4;
  if (kind === 'weekly' && !days.length) throw userError('Escolha ao menos um dia da semana');
  return { kind, time, days: kind === 'weekly' ? days : [], hours };
}

// The next time a schedule fires strictly after `from` (local time), or null when it only runs on request.
function nextRun(schedule, from) {
  const s = normalizeSchedule(schedule);
  if (s.kind === 'manual') return null;
  if (s.kind === 'interval') return from + s.hours * HOUR;
  const [h, m] = s.time.split(':').map(Number);
  const ok = (d) => s.kind === 'daily' || (s.kind === 'weekdays' ? d >= 1 && d <= 5 : s.days.includes(d));
  const t = new Date(from);
  t.setHours(h, m, 0, 0);
  for (let i = 0; i < 8; i++) {
    if (t.getTime() > from && ok(t.getDay())) return t.getTime();
    t.setDate(t.getDate() + 1);
    t.setHours(h, m, 0, 0); // a DST change never shifts the hour
  }
  return null;
}

// How the schedule reads on the screen.
function describeSchedule(schedule) {
  const s = normalizeSchedule(schedule);
  if (s.kind === 'manual') return 'Só quando você pedir';
  if (s.kind === 'interval') return s.hours === 1 ? 'A cada hora' : 'A cada ' + s.hours + ' horas';
  const at = ' às ' + s.time;
  if (s.kind === 'daily') return 'Todo dia' + at;
  if (s.kind === 'weekdays') return 'Dias úteis' + at;
  const names = s.days.map((d) => DAY[d]);
  if (names.length === 7) return 'Todo dia' + at;
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1] : names[0];
  return list.charAt(0).toUpperCase() + list.slice(1) + at;
}

// What the person typed, checked; `prev` keeps what is not part of the form (runs, ids, dates).
function normalizeAgent(input = {}, prev = null) {
  const name = clean(input.name, MAX_NAME);
  if (!name) throw userError('Dê um nome ao agent');
  const prompt = clean(input.prompt, MAX_PROMPT);
  if (!prompt) throw userError('Escreva o que o agent deve fazer');
  if (!PROVIDER_IDS.includes(input.provider)) throw userError('Escolha a IA do agent');
  return {
    ...(prev || {}),
    name,
    prompt,
    provider: input.provider,
    model: clean(input.model, 120),
    projectId: input.projectId || null,
    mode: MODES.includes(input.mode) ? input.mode : 'read',
    memory: input.memory !== false,
    skills: input.skills !== false,
    schedule: normalizeSchedule(input.schedule),
    enabled: input.enabled !== false,
    catchUp: input.catchUp !== false,
  };
}

const isRunning = (a) => (a.runs || []).some((r) => r.status === 'running');
const lastRun = (a) => (a.runs || [])[0] || null;
// Enabled agents whose time has come; one already running waits for its next time.
const dueAgents = (agents, now) =>
  (agents || []).filter((a) => a.enabled && a.nextRunAt && a.nextRunAt <= now && !isRunning(a));

// The agent's last words as a one-line result: its "Resumo:" line when it wrote one, else the start of the answer.
function summaryOf(text) {
  const src = String(text || '').replace(/```[\s\S]*?```/g, ' ');
  const tagged = /(?:^|\n)\s*(?:\*\*)?Resumo:?(?:\*\*)?:?\s*(.+)/i.exec(src);
  const plain = (tagged ? tagged[1] : src)
    .replace(/[#>*_`|[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > MAX_SUMMARY ? plain.slice(0, MAX_SUMMARY - 1).trimEnd() + '…' : plain;
}

// The message a run sends: who the agent is, the rules of working alone, its last result, then the task.
function buildPrompt(agent, { now = Date.now(), projectName = '' } = {}) {
  const last = (agent.runs || []).find((r) => r.status === 'ok' && r.summary);
  const when = new Date(now).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
  return [
    'Você é o agent "' + agent.name + '" do VeSTA, rodando sozinho (' + when + '): ninguém está acompanhando agora.',
    '## Como trabalhar\n' +
      '- Use a memória ' +
      (projectName ? 'do projeto ' + projectName : 'do VeSTA') +
      (agent.skills ? ' e as skills disponíveis' : '') +
      ' quando ajudarem.\n' +
      '- Não publique nada fora deste computador (push, PR, comentários, mensagens, e-mails): prepare e descreva para a pessoa aprovar.\n' +
      '- Se travar ou precisar de uma decisão, pare e diga exatamente o que precisa.\n' +
      '- Termine com uma linha "Resumo: …" de uma frase: o que fez, o que achou ou o que precisa da pessoa.',
    last ? '## Última execução\n' + last.summary : '',
    '## Tarefa\n' + agent.prompt,
  ]
    .filter(Boolean)
    .join('\n\n');
}

module.exports = {
  PROVIDER_IDS,
  MODES,
  KINDS,
  INTERVALS,
  MAX_RUNS,
  DAY,
  normalizeSchedule,
  nextRun,
  describeSchedule,
  normalizeAgent,
  isRunning,
  lastRun,
  dueAgents,
  summaryOf,
  buildPrompt,
};
