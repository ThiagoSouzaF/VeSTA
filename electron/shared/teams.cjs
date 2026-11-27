// Equipes (Agent Mode): agents with a role working together on one project, on a shared board, talking through the
// wires of the team's desk. Pure rules shared by the main process (teams/) and the screen: no require.
//
// team = { id, name, projectId, goal, members: [member], maxParallel, budget (tokens a day, 0 = none), maxTurns (per
//          start), status: 'idle' | 'running' | 'paused' | 'stopped', tasks: [task], messages: [message],
//          asks: [ask], spent: { day, tokens }, turns (since the last start), note, createdAt, updatedAt }
// member = { id, name, role, provider, model, mode: 'read' | 'edit', lead, x, y, chatId, busy, readAt,
//            branch, workdir, tokens, place: 'pc' | <vps id>, job: { id, place, at } (a turn running on a VPS) }
// A member on a VPS (place) has no chat: each turn is one job of the runner there (places/engine.cjs) and it talks
// through action lines at the end of its answer (actionsOf), which VeSTA carries over SSH. A message to a member whose
// place is offline is held (message.held) until the place is back.
// task = { id, title, detail, assignee, reviewer (who was asked to review it), column: 'todo' | 'doing' | 'review' | 'done', by, at, updatedAt, note }
// message = { id, at, from, to, kind, text, held? } (from/to: a member id or HUMAN)
// ask = { id, at, from, text, status: 'open' | 'answered', answer }

const HUMAN = 'voce';
const PROVIDERS = ['claude', 'codex', 'opencode', 'drael'];
// No 'ask': nobody watches a team agent's chat to approve each step, so it only reads or edits on its own.
const MODES = ['read', 'edit'];
const COLUMNS = ['todo', 'doing', 'review', 'done'];
const KINDS = ['task', 'ask', 'answer', 'review', 'human', 'note'];
const MAX_MEMBERS = 6;
const MAX_MESSAGES = 300;
const MAX_TASKS = 60;
const PARALLEL = [1, 2, 3, 4];
const DEFAULT_BUDGET = 2000000;
const DEFAULT_TURNS = 40;

const clip = (s, n) =>
  String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
const clipText = (s, n) =>
  String(s == null ? '' : s)
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, n);
const slug = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'membro';

// Ready-made teams (the form starts from one).
const TEMPLATES = {
  trio: {
    label: 'Líder, Dev e Revisor',
    members: [
      { name: 'Líder', role: 'planeja, distribui e junta o trabalho', provider: 'claude', mode: 'read', lead: true },
      { name: 'Dev', role: 'implementa as tarefas', provider: 'codex', mode: 'edit' },
      { name: 'Revisor', role: 'revisa o código e devolve com o motivo', provider: 'claude', mode: 'read' },
    ],
  },
  squad: {
    label: 'Líder, Dev, Testes, Revisor e Docs',
    members: [
      { name: 'Líder', role: 'planeja, distribui e junta o trabalho', provider: 'claude', mode: 'read', lead: true },
      { name: 'Dev', role: 'implementa as tarefas', provider: 'codex', mode: 'edit' },
      { name: 'Testes', role: 'escreve e roda os testes', provider: 'opencode', mode: 'edit' },
      { name: 'Revisor', role: 'revisa o código e devolve com o motivo', provider: 'claude', mode: 'read' },
      { name: 'Docs', role: 'atualiza o README e a documentação', provider: 'drael', mode: 'edit' },
    ],
  },
};

// Where the cards start on the desk (fractions of its size): you on top, the lead in the middle, the others in an arc.
function layout(members) {
  const others = members.filter((m) => !m.lead);
  return members.map((m) => {
    if (m.lead) return { ...m, x: 0.5, y: 0.44 };
    const i = others.indexOf(m),
      n = others.length;
    const t = n === 1 ? 0.5 : i / (n - 1);
    const angle = Math.PI * (0.92 - 0.84 * t);
    return { ...m, x: 0.5 + Math.cos(angle) * 0.36, y: 0.56 + Math.sin(angle) * 0.28 };
  });
}

const unit = (v, d) => (Number.isFinite(Number(v)) ? Math.min(0.95, Math.max(0.05, Number(v))) : d);

// What the form sends -> a valid team (runtime fields of `prev` kept). Throws a message for the person when invalid.
function normalizeTeam(input = {}, prev = null) {
  const name = clip(input.name, 60);
  if (!name) throw new Error('Dê um nome para a equipe');
  if (!input.projectId) throw new Error('Escolha o projeto em que a equipe trabalha');
  const goal = clipText(input.goal, 4000);
  if (!goal) throw new Error('Escreva o objetivo da equipe');
  const raw = Array.isArray(input.members) ? input.members.slice(0, MAX_MEMBERS) : [];
  if (raw.length < 2) throw new Error('Uma equipe precisa de pelo menos dois agents');
  const ids = new Set();
  let members = raw.map((m, i) => {
    const mName = clip(m.name, 30) || 'Agent ' + (i + 1);
    let id = m.id && !ids.has(m.id) ? String(m.id).slice(0, 40) : slug(mName);
    while (ids.has(id) || id === HUMAN) id += '-' + (i + 1);
    ids.add(id);
    const old = prev?.members?.find((x) => x.id === id) || {};
    return {
      ...old,
      id,
      name: mName,
      role: clip(m.role, 120) || 'ajuda a equipe',
      provider: PROVIDERS.includes(m.provider) ? m.provider : 'claude',
      model: clip(m.model, 80),
      mode: MODES.includes(m.mode) ? m.mode : 'edit',
      lead: !!m.lead,
      place: /^[\w-]{1,40}$/.test(String(m.place || '')) ? String(m.place) : 'pc',
      x: unit(m.x ?? old.x, null),
      y: unit(m.y ?? old.y, null),
    };
  });
  const names = members.map((m) => m.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error('Cada agent da equipe precisa de um nome diferente');
  const leads = members.filter((m) => m.lead);
  if (leads.length !== 1) {
    members.forEach((m) => (m.lead = false));
    (leads[0] || members[0]).lead = true;
  }
  if (members.some((m) => m.x == null || m.y == null)) {
    const placed = layout(members);
    members = members.map((m, i) => (m.x == null || m.y == null ? { ...m, x: placed[i].x, y: placed[i].y } : m));
  }
  const budget = Number(input.budget);
  return {
    ...(prev || {}),
    name,
    projectId: String(input.projectId),
    goal,
    members,
    maxParallel: PARALLEL.includes(Number(input.maxParallel)) ? Number(input.maxParallel) : 2,
    budget: Number.isFinite(budget) && budget >= 0 ? Math.round(budget) : DEFAULT_BUDGET,
    maxTurns: Math.min(200, Math.max(4, Math.round(Number(input.maxTurns) || DEFAULT_TURNS))),
    memory: input.memory !== false,
    status: prev?.status || 'idle',
    tasks: prev?.tasks || [],
    messages: prev?.messages || [],
    asks: prev?.asks || [],
    spent: prev?.spent || { day: '', tokens: 0 },
    turns: prev?.turns || 0,
  };
}

const leadOf = (team) => team.members.find((m) => m.lead) || team.members[0];
const memberOf = (team, id) => team.members.find((m) => m.id === id) || null;
const nameOf = (team, id) => (id === HUMAN ? 'Você' : memberOf(team, id)?.name || id);
// A member named by the AI ("Dev", "dev", "voce", "Você") -> its id, or null.
function resolve(team, who) {
  const w = slug(who);
  if (w === 'voce' || w === 'pessoa' || w === 'humano') return HUMAN;
  const m = team.members.find((x) => x.id === who || slug(x.name) === w || x.id === w);
  return m ? m.id : null;
}

// The wires on the desk: you and the lead, the lead and each member, and every pair that has talked.
function wiresOf(team) {
  const lead = leadOf(team);
  const key = (a, b) => [a, b].sort().join('|');
  const out = new Map();
  const add = (a, b) => {
    if (a && b && a !== b && !out.has(key(a, b))) out.set(key(a, b), [a, b]);
  };
  add(HUMAN, lead.id);
  for (const m of team.members) if (m !== lead) add(lead.id, m.id);
  for (const msg of team.messages || []) if (msg.kind !== 'note') add(msg.from, msg.to);
  return [...out.values()];
}

// Day key for the budget ("2026-11-26", local time).
const dayOf = (t) => {
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const spentToday = (team, now) => (team.spent?.day === dayOf(now) ? team.spent.tokens || 0 : 0);
const overBudget = (team, now) => team.budget > 0 && spentToday(team, now) >= team.budget;

// Messages for a member it has not seen yet (sent after its last turn started).
const inboxOf = (team, id) =>
  (team.messages || []).filter(
    (m) => m.to === id && m.from !== id && m.kind !== 'note' && m.at > (memberOf(team, id)?.readAt || 0)
  );
const tasksOf = (team, id) => (team.tasks || []).filter((t) => t.assignee === id && t.column !== 'done');
// What a member works on now: its task in progress, else the first one waiting.
const currentTask = (team, id) => {
  const mine = tasksOf(team, id);
  return mine.find((t) => t.column === 'doing') || mine.find((t) => t.column === 'todo') || null;
};
const openAsks = (team) => (team.asks || []).filter((a) => a.status === 'open');

// Who wakes now: idle members with something new (a message, or a task of theirs nobody has started), the lead first,
// never more at once than the team allows. A member that asked the person something waits for the answer.
// away: ids of members whose place is offline (their messages wait).
function due(team, now, away = new Set()) {
  if (team.status !== 'running' || overBudget(team, now) || (team.turns || 0) >= team.maxTurns) return [];
  const busy = team.members.filter((m) => m.busy).length;
  const room = Math.max(0, team.maxParallel - busy);
  if (!room) return [];
  const waiting = new Set(openAsks(team).map((a) => a.from));
  const wants = (m) =>
    !m.busy &&
    !waiting.has(m.id) &&
    !away.has(m.id) &&
    (inboxOf(team, m.id).length > 0 ||
      tasksOf(team, m.id).some((t) => t.column === 'todo' && (t.updatedAt || t.at) > (m.readAt || 0)));
  const lead = leadOf(team);
  return [lead, ...team.members.filter((m) => m !== lead)].filter(wants).slice(0, room);
}

// A card's state on the desk.
function memberState(team, m) {
  if (team.status === 'stopped') return 'stopped';
  if (m.busy) return 'working';
  if (openAsks(team).some((a) => a.from === m.id)) return 'waiting';
  return 'idle';
}
const STATE_LABELS = {
  working: 'Trabalhando',
  waiting: 'Esperando você',
  idle: 'Parado',
  stopped: 'Parado por você',
};

const hhmm = (t) => {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};
const KIND_LABELS = {
  task: 'tarefa',
  ask: 'pergunta',
  answer: 'resposta',
  review: 'revisão',
  human: 'seu sim',
  note: 'nota',
};
const COLUMN_LABELS = { todo: 'A fazer', doing: 'Fazendo', review: 'Revisão', done: 'Feito' };

// The text a member receives on each turn: who it is, the team, where it works, how to talk, what is new.
// remote: the name of the VPS the member runs on (no tools there: action lines, and the board comes in the text).
function buildTurn(team, member, { projectName = '', now = Date.now(), first = false, remote = '' } = {}) {
  const lead = leadOf(team);
  const isLead = member.id === lead.id;
  const roster = team.members
    .map((m) => '- ' + m.name + (m.lead ? ' (líder)' : '') + ': ' + m.role + (m.id === member.id ? ' ← você' : ''))
    .concat('- Você (a pessoa, nas ferramentas "voce"): aprova juntar branches e publicar; responde quando perguntada.')
    .join('\n');
  const where = remote
    ? 'Você roda em ' +
      remote +
      ', numa pasta só sua lá, que fica de um turno para o outro. O projeto está no PC da pessoa: você não vê os arquivos dele, então trabalhe na sua pasta e conte nas mensagens o que fez e o que achou.' +
      (member.mode === 'read' ? ' Você só lê e roda comandos de leitura (modo consulta).' : '')
    : member.mode === 'read'
      ? 'Você só lê arquivos e roda comandos de leitura (modo consulta). Para ver o trabalho de outro agent, leia a pasta dele (o quadro mostra as pastas).'
      : member.branch
        ? 'Sua pasta é ' +
          member.workdir +
          ', na branch ' +
          member.branch +
          '. Trabalhe só nela, faça commits pequenos nessa branch e nunca faça push, merge, rebase nem troque de branch: juntar é com a pessoa.'
        : 'Você trabalha na pasta do projeto, junto com a equipe: mexa só nos arquivos da sua tarefa e não faça commits sem a tarefa pedir.';
  const inbox = inboxOf(team, member.id);
  const mine = tasksOf(team, member.id);
  const lines = [
    'Você é ' +
      member.name +
      ' (' +
      member.role +
      ') na equipe "' +
      team.name +
      '" do VeSTA, no projeto ' +
      (projectName || 'escolhido') +
      '.',
    'Objetivo da equipe: ' + team.goal,
    'A equipe:\n' + roster,
    where,
    remote
      ? remoteTools(isLead)
      : 'Para falar com a equipe use as ferramentas do servidor vesta-skills: vesta_team_board (o quadro, as tarefas, as pastas e as últimas mensagens), vesta_team_send (mandar uma mensagem a um agent pelo nome, ou à pessoa com para="voce"; tipo: pergunta, resposta, revisao, tarefa ou sim), ' +
        (isLead ? 'vesta_team_task (criar uma tarefa para um agent) ' : '') +
        'e vesta_team_move (mover uma tarefa: fazendo, revisao, feito; ou de volta para a_fazer com o motivo). Elas não alteram arquivos e funcionam em qualquer modo.',
    remote
      ? 'Regras: fale só quando precisar (não mande mensagem só para agradecer ou confirmar). Quem recebe uma mensagem acorda para responder, então seja direto. Ao terminar uma tarefa, mova para revisão e avise quem revisa. Termine com uma linha curta do que fez (antes das linhas de ação).'
      : 'Regras: fale só quando precisar (não mande mensagem só para agradecer ou confirmar). Quem recebe uma mensagem acorda para responder, então seja direto. Ao terminar uma tarefa, mova para revisão e avise quem revisa. Peça o sim da pessoa (para="voce", tipo "sim") antes de juntar branches ou publicar qualquer coisa. Termine cada turno com uma linha curta do que fez.',
  ];
  if (isLead && first)
    lines.push(
      'Primeiro turno: leia o projeto o bastante para planejar, quebre o objetivo em poucas tarefas (uma por agent, pelo papel de cada um) com vesta_team_task e acompanhe. Você não implementa: distribui, responde dúvidas, confere as revisões e, no fim, pede o sim da pessoa para juntar.'
    );
  lines.push(
    inbox.length
      ? 'Mensagens novas para você:\n' +
          inbox
            .map((m) => '- [' + hhmm(m.at) + '] ' + nameOf(team, m.from) + ' (' + KIND_LABELS[m.kind] + '): ' + m.text)
            .join('\n')
      : 'Nenhuma mensagem nova.'
  );
  lines.push(
    mine.length
      ? 'Suas tarefas:\n' +
          mine
            .map(
              (t) =>
                '- ' +
                t.id +
                ' [' +
                COLUMN_LABELS[t.column] +
                '] ' +
                t.title +
                (t.detail ? ': ' + t.detail : '') +
                (t.note ? ' (nota: ' + t.note + ')' : '')
            )
            .join('\n')
      : 'Nenhuma tarefa sua aberta.'
  );
  if (remote) lines.push('O quadro agora:\n' + JSON.stringify(boardView(team)));
  return lines.join('\n\n');
}

// ---- A member on a VPS: action lines instead of tools ---------------------------------------------------------
const ACTION_TOOLS = ['vesta_team_send', 'vesta_team_task', 'vesta_team_move'];
function remoteTools(isLead) {
  return [
    'Para falar com a equipe, termine a resposta com linhas de ação, uma por linha, cada uma com o nome e um JSON numa linha só. O VeSTA leva cada uma pela conexão SSH:',
    'vesta_team_send {"para":"Líder","tipo":"resposta","texto":"..."} (para um agent pelo nome, ou "voce" para a pessoa; tipo: pergunta, resposta, revisao, tarefa ou sim)',
    ...(isLead
      ? ['vesta_team_task {"para":"Dev","titulo":"...","detalhe":"..."} (criar uma tarefa para um agent)']
      : []),
    'vesta_team_move {"id":"T1","coluna":"revisao","para":"Revisor","nota":"..."} (fazendo, revisao, feito; ou a_fazer com o motivo)',
    'O quadro, as tarefas e as últimas mensagens estão no fim deste pedido.',
  ].join('\n');
}
const ACTION_LINE = /^\s*[`*-]*\s*(vesta_team_(?:send|task|move))\s*[:(]?\s*(\{.*\})\s*\)?[`*]*\s*$/;
// The action lines of an answer: [{ tool, args }] (a line that is not valid JSON is skipped, said in `bad`).
function actionsOf(text) {
  const out = [];
  let bad = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = ACTION_LINE.exec(line);
    if (!m) continue;
    try {
      const args = JSON.parse(m[2]);
      if (args && typeof args === 'object' && !Array.isArray(args)) out.push({ tool: m[1], args });
      else bad++;
    } catch {
      bad++;
    }
  }
  return Object.assign(out, { bad });
}
// The answer without its action lines (what the card shows as the last line).
const proseOf = (text) =>
  String(text || '')
    .split(/\r?\n/)
    .filter((l) => !ACTION_LINE.test(l))
    .join('\n')
    .trim();
// Where a team runs: [{ place, count }], the most members first (this PC when tied).
function placesOf(team) {
  const n = new Map();
  for (const m of team.members) n.set(m.place || 'pc', (n.get(m.place || 'pc') || 0) + 1);
  return [...n.entries()]
    .map(([place, count]) => ({ place, count }))
    .sort((a, b) => b.count - a.count || (a.place === 'pc' ? -1 : b.place === 'pc' ? 1 : 0));
}
const remoteMember = (m) => !!m.place && m.place !== 'pc';

// The board as the tools return it (and as the person sees it).
function boardView(team) {
  return {
    objetivo: team.goal,
    membros: team.members.map((m) => ({
      nome: m.name,
      papel: m.role,
      lider: m.lead,
      ia: m.provider,
      modo: m.mode,
      pasta: m.workdir || null,
      branch: m.branch || null,
      ocupado: !!m.busy,
    })),
    tarefas: (team.tasks || []).map((t) => ({
      id: t.id,
      titulo: t.title,
      detalhe: t.detail,
      com: nameOf(team, t.assignee),
      coluna: COLUMN_LABELS[t.column],
      nota: t.note || '',
    })),
    mensagens: (team.messages || []).slice(-20).map((m) => ({
      hora: hhmm(m.at),
      de: nameOf(team, m.from),
      para: m.to ? nameOf(team, m.to) : '',
      tipo: KIND_LABELS[m.kind],
      texto: m.text,
    })),
  };
}

// Tool words -> kinds and columns.
const KIND_WORDS = {
  pergunta: 'ask',
  resposta: 'answer',
  revisao: 'review',
  revisão: 'review',
  tarefa: 'task',
  sim: 'human',
};
const COLUMN_WORDS = {
  a_fazer: 'todo',
  fazer: 'todo',
  fazendo: 'doing',
  revisao: 'review',
  revisão: 'review',
  feito: 'done',
};
const kindOf = (w) => KIND_WORDS[String(w || '').toLowerCase()] || 'ask';
const columnOf = (w) =>
  COLUMN_WORDS[
    String(w || '')
      .toLowerCase()
      .replace(/\s+/g, '_')
  ] || null;

module.exports = {
  HUMAN,
  MODES,
  COLUMNS,
  KINDS,
  MAX_MEMBERS,
  MAX_MESSAGES,
  MAX_TASKS,
  PARALLEL,
  DEFAULT_BUDGET,
  DEFAULT_TURNS,
  TEMPLATES,
  STATE_LABELS,
  KIND_LABELS,
  COLUMN_LABELS,
  layout,
  normalizeTeam,
  leadOf,
  memberOf,
  nameOf,
  resolve,
  wiresOf,
  dayOf,
  spentToday,
  overBudget,
  inboxOf,
  tasksOf,
  currentTask,
  openAsks,
  due,
  memberState,
  buildTurn,
  boardView,
  ACTION_TOOLS,
  actionsOf,
  proseOf,
  placesOf,
  remoteMember,
  kindOf,
  columnOf,
  slug,
  hhmm,
};
