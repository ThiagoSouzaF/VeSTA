// Equipes screen logic (pure): the rules live in electron/shared/teams.cjs, shared with the main process; here, what
// only the screen needs (the form's blank team, the curve of a wire, the counts of the header).
import shared from '../../electron/shared/teams.cjs';

export const {
  HUMAN,
  MODES,
  COLUMNS,
  MAX_MEMBERS,
  PARALLEL,
  DEFAULT_BUDGET,
  DEFAULT_TURNS,
  TEMPLATES,
  STATE_LABELS,
  KIND_LABELS,
  COLUMN_LABELS,
  leadOf,
  memberOf,
  nameOf,
  wiresOf,
  spentToday,
  currentTask,
  openAsks,
  memberState,
  layout,
  hhmm,
  placesOf,
  MAX_SOUL,
} = shared;

const ORDER = ['claude', 'codex', 'opencode', 'drael'];

// A template with the AIs that are not installed swapped for the first one that is.
export function blankTeam(integrations = {}, template = 'trio', projectId = '') {
  const fallback = ORDER.find((p) => integrations[p]?.installed) || 'claude';
  return {
    name: '',
    projectId,
    goal: '',
    members: TEMPLATES[template].members.map((m) => ({
      ...m,
      model: '',
      provider: integrations[m.provider]?.installed ? m.provider : fallback,
    })),
    maxParallel: 2,
    budget: DEFAULT_BUDGET,
    maxTurns: DEFAULT_TURNS,
    memory: true,
  };
}

// The form's view of a saved team (only what the person edits).
export const editableTeam = (t) => ({
  name: t.name,
  projectId: t.projectId,
  goal: t.goal,
  context: t.context || '',
  members: t.members.map(({ id, name, role, soul, provider, model, mode, lead, x, y, place }) => ({
    id,
    name,
    role,
    soul: soul || '',
    provider,
    model,
    mode,
    lead,
    x,
    y,
    place: place || 'pc',
  })),
  maxParallel: t.maxParallel,
  budget: t.budget,
  maxTurns: t.maxTurns,
  memory: t.memory,
});

// Where "Você" sits on the desk: where the person left it, else above the lead.
export const youAt = (team) => {
  if (team.you) return team.you;
  const lead = leadOf(team);
  return { x: lead.x, y: Math.max(0.06, lead.y - 0.36) };
};

// A wire between two card centres: it leaves vertically when the cards are more above each other than side by side.
export function curve([x1, y1], [x2, y2]) {
  const dx = x2 - x1,
    dy = y2 - y1;
  if (Math.abs(dy) > Math.abs(dx) * 0.6) {
    const k = dy * 0.5;
    return `M${x1},${y1} C${x1},${y1 + k} ${x2},${y2 - k} ${x2},${y2}`;
  }
  const k = dx * 0.5;
  return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`;
}
export const wireKey = (a, b) => [a, b].sort().join('|');

// The words of the team's state, for the header and the list.
export const TEAM_STATUS = { idle: 'Nova', running: 'Trabalhando', paused: 'Pausada', stopped: 'Parada' };

export function teamCounts(team) {
  const working = team.members.filter((m) => m.busy).length;
  return { working, agents: team.members.length, waiting: openAsks(team).length };
}

// Messages that travel on the desk (notes are the VeSTA talking, they have no wire).
export const travels = (m) => m.kind !== 'note' && m.from && m.to;

// ---- What waits for the person, and the conversation with one agent ----------------------------------------------
// Every open ask of every team, oldest first: [{ team, ask, member }].
export function pendingFor(teams = []) {
  return teams
    .flatMap((team) =>
      openAsks(team).map((ask) => ({ team, ask, member: team.members.find((m) => m.id === ask.from) || null }))
    )
    .sort((a, b) => a.ask.at - b.ask.at);
}
// A yes/no ask (the agent used tipo "sim") is answered with Aceitar / Recusar; a question asks for words.
export const yesNo = (ask) => ask.kind !== 'ask';
// The words sent for Aceitar / Recusar (with the reason, when there is one).
export const decisionText = (decision, reason = '') =>
  (decision === 'yes' ? 'Sim, pode.' : 'Não.') + (reason.trim() ? ' ' + reason.trim() : '');

// The conversation between the person and one agent, oldest first: the team messages between them ('you' / 'them')
// and what the agent answered on each turn in its chat ('turn': the real chat, also while it streams).
// Items: { id, at, side, kind?, text, held?, live? }.
export function talkWith(team, memberId, chat = null, running = []) {
  const items = (team.messages || [])
    .filter(
      (m) => m.kind !== 'note' && ((m.from === HUMAN && m.to === memberId) || (m.from === memberId && m.to === HUMAN))
    )
    .map((m) => ({
      id: 'm:' + m.id,
      at: m.at,
      side: m.from === HUMAN ? 'you' : 'them',
      kind: m.kind,
      text: m.text,
      held: !!m.held,
    }));
  for (const [i, m] of (chat?.messages || []).entries())
    if (m.role === 'assistant' && (m.text || '').trim())
      items.push({
        id: 'c:' + (m.id || i),
        at: m.createdAt || 0,
        side: 'turn',
        text: m.text,
        live: running.includes(chat.id) && i === chat.messages.length - 1,
      });
  return items.sort((a, b) => a.at - b.at);
}
