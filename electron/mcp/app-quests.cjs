// Quests from inside a conversation (part of vesta-app): "monte uma quest para lançar o site e já inicie" turns into a
// quest of this chat's project, planned by an AI (or with the steps the chat already wrote), started when asked.
// The person sees each quest appear and can follow it on the Quests screen; "Só consulta" chats only list and open.
const PROVIDERS = ['claude', 'codex', 'opencode', 'drael'];
const MODES = ['edit', 'read', 'ask'];

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const id = str('Id da quest (de vesta_quest_list ou vesta_quest_create).');
const STEP = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'instructions'],
  properties: {
    id: str('Id curto da etapa ("s1", "s2"...), para dependsOn.'),
    title: str('Título curto.'),
    instructions: str('Instruções completas: a IA da etapa não vê esta conversa.'),
    provider: str('IA da etapa.', { enum: PROVIDERS }),
    model: str('Modelo; vazio = padrão da conta.'),
    mode: str('edit = acesso completo, read = só consulta, ask = pede permissão.', { enum: MODES }),
    dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ids das etapas que precisam terminar antes.' },
  },
};

const QUEST_TOOLS = [
  [
    'vesta_quest_create',
    'Cria uma quest no VeSTA, no projeto desta conversa. Sem "steps", uma IA planeja as etapas (planner); com "steps", usa as suas. Com start=true ela começa sozinha (logo, ou assim que o plano ficar pronto). Use só quando a pessoa pedir uma quest; confirme objetivo e se deve iniciar.',
    obj(
      {
        title: str('Título curto da quest.'),
        goal: str('Objetivo completo, com o que conta como pronto.'),
        guidelines: str('Regras e preferências para todas as etapas (opcional).'),
        steps: { type: 'array', items: STEP, description: 'Plano pronto (opcional, até 12 etapas).' },
        planner: str('IA que planeja quando não há steps (padrão: a desta conversa).', { enum: PROVIDERS }),
        start: { type: 'boolean', description: 'Iniciar sem esperar a pessoa revisar o plano.' },
      },
      ['title', 'goal']
    ),
  ],
  ['vesta_quest_list', 'Quests do VeSTA, com situação e progresso (as deste projeto primeiro).', obj()],
  ['vesta_quest_get', 'Situação completa de uma quest: etapas, IAs, resultados e diário.', obj({ id }, ['id'])],
  ['vesta_quest_start', 'Inicia uma quest em rascunho (com plano pronto) ou retoma uma pausada.', obj({ id }, ['id'])],
  ['vesta_quest_pause', 'Pausa uma quest: as etapas em curso terminam e nenhuma nova começa.', obj({ id }, ['id'])],
  ['vesta_quest_open', 'Abre a quest na tela de Quests do VeSTA para a pessoa acompanhar.', obj({ id }, ['id'])],
];
const QUEST_READ_ONLY = ['vesta_quest_list', 'vesta_quest_get', 'vesta_quest_open'];

const summary = (q, projects) => {
  const done = q.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  return {
    id: q.id,
    titulo: q.title,
    situacao: q.planning?.status === 'running' ? 'planejando' : q.status,
    etapas: done + '/' + q.steps.length,
    projeto: projects.find((p) => p.id === q.projectId)?.name || 'Espaço pessoal',
    iniciaSozinha: !!q.autoStart,
  };
};

// notice(chat, text): the toast that tells the person what a chat did.
function questHandlers(ctx, notice) {
  const engine = () => ctx.quests;
  const projects = () => ctx.store.state.projects;
  const installedPlanner = (chat, asked) => {
    const ok = (p) => p && ctx.integrations?.[p]?.installed;
    return [asked, chat.provider, ...PROVIDERS].find(ok) || null;
  };
  return {
    vesta_quest_create: (chat, a) => {
      const steps = Array.isArray(a.steps) && a.steps.length ? a.steps : null;
      const planner = steps ? null : installedPlanner(chat, a.planner);
      if (!steps && !planner) throw Object.assign(new Error('Nenhuma IA instalada para planejar'), { userSafe: true });
      const q = engine().createQuest({
        title: a.title,
        goal: a.goal,
        guidelines: a.guidelines || '',
        projectId: chat.projectId || null,
        steps: steps || undefined,
        plan: steps ? undefined : { provider: planner, model: '' },
        autoStart: !!a.start && !steps,
      });
      if (steps && a.start) engine().startQuest({ id: q.id });
      notice(chat, 'criou a quest "' + q.title + '"' + (a.start ? ' e pediu para iniciar.' : '.'));
      return {
        ok: true,
        quest: summary(q, projects()),
        proximo: steps
          ? a.start
            ? 'Rodando. Acompanhe com vesta_quest_get.'
            : 'Rascunho com plano: a pessoa pode revisar, ou use vesta_quest_start.'
          : 'Planejando com ' +
            planner +
            (a.start ? '; inicia sozinha quando o plano ficar pronto.' : '; depois revise e inicie.'),
      };
    },
    vesta_quest_list: (chat) => {
      const list = ctx.store.state.quests.map((q) => summary(q, projects()));
      const mine = (s) =>
        (ctx.store.state.quests.find((q) => q.id === s.id)?.projectId || null) === (chat.projectId || null);
      return { quests: [...list.filter(mine), ...list.filter((s) => !mine(s))] };
    },
    vesta_quest_get: (chat, a) => engine().questState({ id: a.id }),
    vesta_quest_start: (chat, a) => {
      const q = ctx.store.state.quests.find((x) => x.id === a.id);
      if (q?.status === 'paused') engine().resumeQuest({ id: a.id });
      else engine().startQuest({ id: a.id });
      notice(chat, 'iniciou a quest "' + (q?.title || a.id) + '".');
      return {
        ok: true,
        quest: summary(
          ctx.store.state.quests.find((x) => x.id === a.id),
          projects()
        ),
      };
    },
    vesta_quest_pause: (chat, a) => {
      const q = engine().pauseQuest({ id: a.id });
      notice(chat, 'pausou a quest "' + q.title + '".');
      return { ok: true, quest: summary(q, projects()) };
    },
    vesta_quest_open: (chat, a) => {
      if (!ctx.store.state.quests.some((q) => q.id === a.id))
        throw Object.assign(new Error('Quest não encontrada'), { userSafe: true });
      ctx.emit({ type: 'open-quest', questId: a.id });
      return { ok: true, aberta: a.id };
    },
  };
}

module.exports = { QUEST_TOOLS, QUEST_READ_ONLY, questHandlers };
