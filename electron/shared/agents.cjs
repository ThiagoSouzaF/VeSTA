// Agents (Agent Mode): a named job an AI does on its own, on a schedule or when the person asks, with the memory and
// the skills of VeSTA. Pure functions, no I/O: used by the engine (main process), the tests and the screen.
//
// Agent { id, name, prompt, provider, model, projectId, mode, memory, skills, skillNames[], schedule, enabled, catchUp,
//         runs[], lessons[], suggestion, proposal, versions[], nextRunAt, unseen, createdAt, updatedAt }
//   skills      the "A IA decide" catalog of the library; skillNames are the agent's own skills, sent whole every run
//   mode      'read' (Consulta) | 'ask' (Pedir permissão: each command waits for the person) | 'edit' (Acesso completo)
//   schedule  { kind: 'manual' | 'daily' | 'weekdays' | 'weekly' | 'interval', time: 'HH:MM', days: [0-6], hours }
//   catchUp   a scheduled time missed while VeSTA was closed runs once when it opens
//   unseen    runs that ended since the person last opened Agent Mode (the rail badge)
// Lesson { id, text, status: 'pending' | 'kept' | 'dropped', from: 'run' | 'chat' | 'person' | 'refine' | 'place', at, runId }: what the
//   agent learned; only kept ones (approved by the person, or written by them) reach the next runs. Dropped ones stay
//   hidden so the agent does not propose them again.
// suggestion { text, at, runId } | null: a better task the agent proposed; it replaces the prompt only on a yes.
// proposal { prompt, lessons[] | null, changes[], at, chatId, provider } | null: what a refinement chat proposed (task
//   and, if given, the new kept lessons); applied only on a yes. versions[]: what the agent was before each change of
//   its task ({ n, at, note, prompt, lessons[] }, newest first; shared/refine.cjs).
// Run { id, at, endedAt, trigger: 'schedule' | 'manual' | 'catch-up', status: 'running' | 'ok' | 'error', chatId,
//       summary, error, place?, usage? }: place = where it ran with VeSTA closed (chatId null, places/engine.cjs)
// places { <placeId>: { slug, hash, at, task, running, outdated } }: where the agent is installed to run with VeSTA
//        closed ('pc' = this PC, else a VPS of state.places; places/engine.cjs)
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
const MAX_SKILLS = 8;
const MAX_LESSON = 240;
const MAX_KEPT = 20;
const MAX_LESSONS = 40;
const MAX_ERRORS = 3;
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
    skillNames: [...new Set((Array.isArray(input.skillNames) ? input.skillNames : []).map((n) => clean(n, 80)))]
      .filter(Boolean)
      .slice(0, MAX_SKILLS),
    schedule: normalizeSchedule(input.schedule),
    enabled: input.enabled !== false,
    catchUp: input.catchUp !== false,
  };
}

const isRunning = (a) => (a.runs || []).some((r) => r.status === 'running');
const lastRun = (a) => (a.runs || [])[0] || null;
// Installed in a place (places/engine.cjs: { pc | <vps id>: { slug, hash, at, running, outdated } }): the place runs it.
const installedSomewhere = (a) => !!a.places && Object.keys(a.places).length > 0;
// Enabled agents whose time has come; one already running waits for its next time; one installed in a place runs
// there, never twice.
const dueAgents = (agents, now) =>
  (agents || []).filter(
    (a) => a.enabled && a.nextRunAt && a.nextRunAt <= now && !isRunning(a) && !installedSomewhere(a)
  );

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

// Tagged lines at the end of a reply (also bold or in a list): "Lição: ..." (up to 2) and "Pedido sugerido: ...".
const LESSON = /^\s*(?:[-*]\s*)?(?:\*\*)?Li[çc][ãa]o:?(?:\*\*)?:?\s*(.+)$/gim;
const SUGGESTION = /^\s*(?:[-*]\s*)?(?:\*\*)?Pedido sugerido:?(?:\*\*)?:?\s*(.+)$/im;
const noCode = (text) => String(text || '').replace(/```[\s\S]*?```/g, ' ');
const plainLine = (t, max) => {
  const v = String(t).replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  return v.length > max ? v.slice(0, max - 1).trimEnd() + '…' : v;
};
function lessonsOf(text) {
  return [...noCode(text).matchAll(LESSON)]
    .map((m) => plainLine(m[1], MAX_LESSON))
    .filter((t) => t.replace(/[.…\s]/g, '').length > 3) // not the "Lição: …" of the instructions
    .slice(0, 2);
}
function suggestionOf(text) {
  const m = SUGGESTION.exec(noCode(text));
  return m ? clean(m[1], MAX_PROMPT) : '';
}
// A lesson the agent already has (same words, ignoring case and spaces) is not added again.
const sameLesson = (a, b) => plainLine(a, MAX_LESSON).toLowerCase() === plainLine(b, MAX_LESSON).toLowerCase();
const keptLessons = (a) => (a.lessons || []).filter((l) => l.status === 'kept');
const pendingLessons = (a) => (a.lessons || []).filter((l) => l.status === 'pending');
// The failures since the last run that worked, newest first: the next run is told so it does not repeat them.
function recentErrors(agent) {
  const out = [];
  for (const r of agent.runs || []) {
    if (r.status === 'ok') break;
    if (r.status === 'error') out.push(r);
  }
  return out.slice(0, MAX_ERRORS);
}

// The message a run sends: who the agent is, the rules of working alone, what it learned, its recent failures, its
// last result, its own skills, then the task. skills: [{ name, body }] (read by the engine from the library).
// standalone: the run happens in an agents folder with VeSTA closed (runner/vesta-agent.cjs), without memory nor library.
function buildPrompt(agent, { now = Date.now(), projectName = '', skills = [], standalone = false } = {}) {
  const last = (agent.runs || []).find((r) => r.status === 'ok' && r.summary);
  const when = new Date(now).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
  const day = (t) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const kept = keptLessons(agent).slice(0, MAX_KEPT);
  const errors = recentErrors(agent);
  return [
    'Você é o agent "' + agent.name + '" do VeSTA, rodando sozinho (' + when + '): ninguém está acompanhando agora.',
    '## Como trabalhar\n' +
      (standalone
        ? '- Você roda pelo agendador deste computador, com o VeSTA fechado: sem a memória do VeSTA. Trabalhe com a pasta' +
          (projectName ? ' do projeto ' + projectName : '') +
          ' e com as skills abaixo.\n'
        : '- Use a memória ' +
          (projectName ? 'do projeto ' + projectName : 'do VeSTA') +
          (agent.skills ? ' e as skills disponíveis' : '') +
          ' quando ajudarem.\n') +
      '- Não publique nada fora deste computador (push, PR, comentários, mensagens, e-mails): prepare e descreva para a pessoa aprovar.\n' +
      '- Se travar ou precisar de uma decisão, pare e diga exatamente o que precisa.\n' +
      '- Termine com uma linha "Resumo: …" de uma frase: o que fez, o que achou ou o que precisa da pessoa.\n' +
      '- Se aprendeu algo que deve valer nas próximas vezes (um atalho, uma armadilha, uma preferência da pessoa), escreva também uma linha "Lição: …" por aprendizado, no máximo duas. Se a pessoa corrigir você nesta conversa, faça o mesmo. Ela aprova antes de valer.\n' +
      '- Se a tarefa abaixo estiver ambígua ou desatualizada, proponha uma versão melhor numa linha "Pedido sugerido: …". Ela só vale com o sim da pessoa.',
    kept.length ? '## O que você já aprendeu (aprovado pela pessoa)\n' + kept.map((l) => '- ' + l.text).join('\n') : '',
    errors.length
      ? '## Execuções que falharam desde a última que deu certo\n' +
        errors.map((r) => '- ' + day(r.at) + ': ' + (r.error || r.summary || 'sem detalhe')).join('\n') +
        '\nNão repita o mesmo caminho. Se o erro não depende de você, diga exatamente o que a pessoa precisa fazer.'
      : '',
    last ? '## Última execução que deu certo\n' + last.summary : '',
    skills.length
      ? '## Skills deste agent\nSiga estas skills, escolhidas pela pessoa para este trabalho.\n\n' +
        skills.map((k) => '<skill nome="' + k.name + '">\n' + k.body + '\n</skill>').join('\n\n')
      : '',
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
  installedSomewhere,
  lastRun,
  dueAgents,
  summaryOf,
  lessonsOf,
  suggestionOf,
  sameLesson,
  keptLessons,
  pendingLessons,
  recentErrors,
  buildPrompt,
  MAX_LESSONS,
};
