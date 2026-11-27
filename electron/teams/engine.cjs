// Equipes in the main process: keeps state.teams and runs each team as agents that wake when there is something for
// them. Every agent has its own chat (teamId + memberId, outside Conversas) and, when it edits, its own git worktree;
// it talks to the others through the vesta_team_* tools (mcp/skills.cjs -> tool()), which only change the team's board
// and messages. A message wakes whoever receives it; a finished turn ('chat-done') frees the agent and wakes the next.
// Limits: agents at once (maxParallel), tokens a day (budget) and turns per start (maxTurns); "Parar todos" stops them.
// deps (tests): { send(ctx, args), now(), installed(provider), git, root, setInterval, clearInterval }
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { UserError } = require('../app/errors.cjs');
const { redact } = require('../memory/redact.cjs');
const T = require('../shared/teams.cjs');
const { createTeamGit } = require('./git.cjs');

const TICK_MS = 15000;
const userSafe = (message) => Object.assign(new Error(message), { userSafe: true });

function createTeamEngine(ctx, deps = {}) {
  const store = ctx.store;
  const send = deps.send || ((...a) => require('../chat/send.cjs').send(...a));
  const now = deps.now || Date.now;
  const installed = deps.installed || ((p) => !!ctx.integrations?.[p]?.installed);
  const git = deps.git || createTeamGit();
  const root = deps.root || path.join(require('electron').app.getPath('userData'), 'teams');
  const teams = () => (store.state.teams ||= []);
  const find = (id) => {
    const t = teams().find((x) => x.id === id);
    if (!t) throw new UserError('Equipe não encontrada');
    return t;
  };
  const project = (t) => store.state.projects.find((p) => p.id === t.projectId) || null;
  const commit = () => {
    store.save();
    ctx.sync?.();
  };
  const busy = (t) => t.members.some((m) => m.busy);

  // ---- Board and messages ----------------------------------------------------------------------------------------
  function post(t, from, to, kind, text) {
    const msg = { id: randomUUID(), at: now(), from, to, kind, text: redact(String(text || '')).slice(0, 2000) };
    t.messages = [...(t.messages || []), msg].slice(-T.MAX_MESSAGES);
    t.updatedAt = msg.at;
    return msg;
  }
  const note = (t, text, from = null) => post(t, from, null, 'note', text);
  function addTask(t, { title, detail, assignee, by }) {
    if ((t.tasks || []).length >= T.MAX_TASKS) throw userSafe('O quadro já tem tarefas demais; feche algumas antes.');
    const n = (t.tasks || []).reduce((max, x) => Math.max(max, Number(String(x.id).slice(1)) || 0), 0) + 1;
    const task = {
      id: 'T' + n,
      title: String(title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140),
      detail: String(detail || '')
        .trim()
        .slice(0, 1200),
      assignee,
      column: 'todo',
      by,
      at: now(),
      updatedAt: now(),
      note: '',
    };
    if (!task.title) throw userSafe('A tarefa precisa de um título.');
    t.tasks = [...(t.tasks || []), task];
    return task;
  }

  // ---- Editing ---------------------------------------------------------------------------------------------------
  function create(input) {
    const t = T.normalizeTeam(input);
    if (!store.state.projects.some((p) => p.id === t.projectId)) throw new UserError('Projeto não encontrado');
    Object.assign(t, { id: randomUUID(), createdAt: now(), updatedAt: now() });
    teams().unshift(t);
    commit();
    return t.id;
  }
  function update({ id, ...input }) {
    const prev = find(id);
    if (busy(prev)) throw new UserError('Espere os agents terminarem o turno (ou pare todos) antes de mudar a equipe');
    let t;
    try {
      t = T.normalizeTeam({ ...prev, ...input }, prev);
    } catch (e) {
      throw new UserError(e.message);
    }
    t.updatedAt = now();
    teams()[teams().indexOf(prev)] = t;
    commit();
  }
  // Cards dragged on the desk (the agents' and the person's): only their place changes.
  function place({ id, positions = {} }) {
    const t = find(id);
    const at = (p) =>
      p && Number.isFinite(p.x) && Number.isFinite(p.y)
        ? { x: Math.min(0.95, Math.max(0.05, p.x)), y: Math.min(0.95, Math.max(0.05, p.y)) }
        : null;
    for (const m of t.members) if (at(positions[m.id])) Object.assign(m, at(positions[m.id]));
    if (at(positions[T.HUMAN])) t.you = at(positions[T.HUMAN]);
    commit();
  }
  // The team goes; its chats come back to Conversas and the agents' folders go (their branches stay in the project).
  async function remove({ id }) {
    const t = find(id);
    if (busy(t)) throw new UserError('Pare a equipe antes de apagar');
    store.state.teams = teams().filter((x) => x !== t);
    for (const c of store.state.chats) if (c.teamId === id) delete c.teamId, delete c.memberId, delete c.workdir;
    commit();
    const p = project(t);
    for (const m of t.members) if (m.branch && p) await git.removeWorktree(p.path, m.workdir).catch(() => {});
  }

  // ---- Running ---------------------------------------------------------------------------------------------------
  // Agents that edit get their own worktree (branch equipe/<team>/<agent>) when the project is a git repository;
  // otherwise everybody shares the project folder (the note says so).
  async function prepare(t) {
    const p = project(t);
    if (!p) throw new UserError('O projeto da equipe não existe mais');
    const editors = t.members.filter((m) => m.mode !== 'read');
    if (!editors.length) return;
    if (!(await git.isRepo(p.path))) {
      if (!t.sharedNoted) note(t, 'O projeto não usa git: os agents dividem a mesma pasta.');
      t.sharedNoted = true;
      return;
    }
    for (const m of editors) {
      if (m.branch && m.workdir && fs.existsSync(m.workdir)) continue;
      const dir = path.join(root, t.id, m.id);
      const branch = 'equipe/' + T.slug(t.name) + '/' + m.id;
      try {
        await git.ensureWorktree(p.path, dir, branch);
        Object.assign(m, { workdir: dir, branch });
      } catch (e) {
        note(
          t,
          m.name +
            ' vai trabalhar na pasta do projeto: não deu para criar a pasta dele (' +
            redact(e.message).slice(0, 200) +
            ').'
        );
      }
    }
  }
  async function start({ id }) {
    const t = find(id);
    if (t.status === 'running') return;
    const missing = t.members.filter((m) => !installed(m.provider));
    if (missing.length)
      throw new UserError(
        'Instale a IA de ' + missing.map((m) => m.name).join(', ') + ' (tela Conexões) ou troque na equipe'
      );
    await prepare(t);
    Object.assign(t, { status: 'running', turns: 0, note: '' });
    // The goal reaches the lead as the person's first task; a team that already worked goes on from its board.
    if (!(t.messages || []).some((m) => m.kind !== 'note'))
      post(t, T.HUMAN, T.leadOf(t).id, 'task', 'Objetivo: ' + t.goal);
    else note(t, 'Você retomou a equipe.', T.HUMAN);
    commit();
    tick();
  }
  function pause({ id }) {
    const t = find(id);
    if (t.status !== 'running') return;
    t.status = 'paused';
    note(t, 'Você pausou a equipe: quem está trabalhando termina o turno, ninguém novo começa.', T.HUMAN);
    commit();
  }
  function stopAll({ id }) {
    const t = find(id);
    t.status = 'stopped';
    for (const m of t.members) if (m.busy && m.chatId) ctx.stopChat?.(m.chatId);
    note(t, 'Você parou todos os agents.', T.HUMAN);
    commit();
  }
  // The person's answer to what an agent asked: it wakes with it.
  function answer({ id, askId, text }) {
    const t = find(id);
    const ask = (t.asks || []).find((a) => a.id === askId && a.status === 'open');
    if (!ask) throw new UserError('Essa pergunta já foi respondida');
    const reply = String(text || '')
      .trim()
      .slice(0, 2000);
    if (!reply) throw new UserError('Escreva a resposta');
    Object.assign(ask, { status: 'answered', answer: reply, answeredAt: now() });
    post(t, T.HUMAN, ask.from, 'answer', reply);
    commit();
    tick();
  }
  // A message of the person to one agent (from the Você card).
  function say({ id, to, text }) {
    const t = find(id);
    if (!T.memberOf(t, to)) throw new UserError('Agent não encontrado');
    const body = String(text || '')
      .trim()
      .slice(0, 2000);
    if (!body) throw new UserError('Escreva a mensagem');
    post(t, T.HUMAN, to, 'task', body);
    commit();
    tick();
  }
  // Joins an agent's branch into the project's branch, on the person's click.
  async function merge({ id, memberId }) {
    const t = find(id);
    const m = T.memberOf(t, memberId);
    const p = project(t);
    if (!m?.branch || !p) throw new UserError('Este agent não tem uma branch própria');
    const r = await git.merge(p.path, m.workdir, m.branch);
    note(t, 'Você juntou ' + m.branch + ' em ' + r.into + '.', T.HUMAN);
    commit();
    return r;
  }
  async function branches({ id }) {
    const t = find(id);
    const p = project(t);
    const out = {};
    for (const m of t.members) if (m.branch && p) out[m.id] = await git.ahead(p.path, m.branch);
    return out;
  }

  // One turn of an agent: its chat (made once), the turn text with what is new, the regular send flow.
  function wake(t, m) {
    const p = project(t);
    // A new AI for the agent starts a new chat (a session belongs to one AI).
    let chat = m.chatId && store.state.chats.find((c) => c.id === m.chatId && c.provider === m.provider);
    if (!chat) {
      chat = store.addChat({
        provider: m.provider,
        model: m.model,
        projectId: t.projectId,
        mode: m.mode,
        memory: t.memory,
      });
      Object.assign(chat, { title: (t.name + ' · ' + m.name).slice(0, 100), teamId: t.id, memberId: m.id });
      m.chatId = chat.id;
    }
    // The chat follows the agent's settings and folder (they may have changed since it was made).
    Object.assign(chat, { model: m.model, mode: m.mode });
    if (m.workdir && fs.existsSync(m.workdir)) chat.workdir = m.workdir;
    else delete chat.workdir;
    const first = !m.turns;
    const text = T.buildTurn(t, m, { projectName: p?.name || '', now: now(), first });
    Object.assign(m, { busy: true, readAt: now(), turns: (m.turns || 0) + 1 });
    t.turns = (t.turns || 0) + 1;
    commit();
    Promise.resolve()
      .then(() => send(ctx, { chatId: chat.id, text }))
      .catch((e) => {
        m.busy = false;
        note(t, m.name + ' não conseguiu começar: ' + redact(e.message).slice(0, 300));
        t.status = 'paused';
        commit();
      });
  }
  function tick() {
    for (const t of teams()) {
      if (t.status !== 'running') continue;
      if (T.overBudget(t, now())) {
        t.status = 'paused';
        note(t, 'A equipe pausou: chegou ao teto de tokens de hoje.');
        commit();
        continue;
      }
      if ((t.turns || 0) >= t.maxTurns && !busy(t)) {
        t.status = 'paused';
        note(t, 'A equipe pausou depois de ' + t.maxTurns + ' turnos. Confira o quadro e continue se quiser.');
        commit();
        continue;
      }
      for (const m of T.due(t, now())) wake(t, m);
    }
  }
  // Every finished turn passes here; only the chats of team agents matter.
  function onChatDone({ chatId, status }) {
    const chat = store.state.chats.find((c) => c.id === chatId);
    if (!chat?.teamId) return;
    const t = teams().find((x) => x.id === chat.teamId);
    const m = t && T.memberOf(t, chat.memberId);
    if (!m) return;
    m.busy = false;
    const reply = [...chat.messages].reverse().find((x) => x.role === 'assistant');
    const used = reply?.usage
      ? (reply.usage.inputTokens || 0) + (reply.usage.cacheTokens || 0) + (reply.usage.outputTokens || 0)
      : 0;
    const day = T.dayOf(now());
    t.spent = { day, tokens: (t.spent?.day === day ? t.spent.tokens : 0) + used };
    m.tokens = (m.tokens || 0) + used;
    if (status !== 'done')
      note(t, m.name + ' parou no meio do turno' + (reply?.error ? ': ' + redact(reply.error).slice(0, 200) : '.'));
    m.lastLine =
      String(reply?.text || '')
        .trim()
        .split('\n')
        .filter(Boolean)
        .pop()
        ?.slice(0, 200) || '';
    commit();
    tick();
  }

  // ---- Tools (vesta_team_*), called by an agent's chat ---------------------------------------------------------
  function tool(chat, name, args = {}) {
    const t = teams().find((x) => x.id === chat.teamId);
    const me = t && T.memberOf(t, chat.memberId);
    if (!me) throw userSafe('Este chat não é de uma equipe');
    const who = (w) => {
      const id = T.resolve(t, w);
      if (!id)
        throw userSafe(
          'Ninguém na equipe se chama "' +
            w +
            '". A equipe: ' +
            t.members.map((m) => m.name).join(', ') +
            ' e voce (a pessoa).'
        );
      return id;
    };
    if (name === 'vesta_team_board') return T.boardView(t);
    if (name === 'vesta_team_send') {
      const to = who(args.para);
      if (to === me.id) throw userSafe('Mande para outro agent (ou para "voce").');
      const text = String(args.texto || '').trim();
      if (!text) throw userSafe('A mensagem está vazia.');
      const kind = to === T.HUMAN && T.kindOf(args.tipo) !== 'answer' ? 'human' : T.kindOf(args.tipo);
      post(t, me.id, to, kind, text);
      if (to === T.HUMAN)
        t.asks = [
          ...(t.asks || []),
          { id: randomUUID(), at: now(), from: me.id, text: text.slice(0, 2000), status: 'open' },
        ];
      commit();
      tick();
      return to === T.HUMAN
        ? {
            entregue: 'Você (a pessoa)',
            aviso: 'A pessoa responde quando puder; você acorda com a resposta. Até lá, não repita a pergunta.',
          }
        : { entregue: T.nameOf(t, to), aviso: T.nameOf(t, to) + ' acorda para ler quando estiver livre.' };
    }
    if (name === 'vesta_team_task') {
      if (!me.lead) throw userSafe('Só o líder cria tarefas. Peça ao líder com vesta_team_send.');
      const assignee = who(args.para);
      if (assignee === T.HUMAN)
        throw userSafe('Tarefas são para os agents; para a pessoa, use vesta_team_send com para="voce".');
      const task = addTask(t, { title: args.titulo, detail: args.detalhe, assignee, by: me.id });
      post(t, me.id, assignee, 'task', task.id + ': ' + task.title + (task.detail ? ' — ' + task.detail : ''));
      commit();
      tick();
      return { tarefa: task.id, com: T.nameOf(t, assignee) };
    }
    if (name === 'vesta_team_move') {
      const task = (t.tasks || []).find((x) => x.id === String(args.id || '').toUpperCase());
      if (!task) throw userSafe('Tarefa não encontrada: ' + args.id + '. Veja o quadro com vesta_team_board.');
      // Who has it, the lead, and — while it is in review — the one asked to review it.
      const reviewing = task.column === 'review' && task.reviewer === me.id;
      if (task.assignee !== me.id && !me.lead && !reviewing)
        throw userSafe('Só ' + T.nameOf(t, task.assignee) + ', quem revisa ou o líder movem a ' + task.id + '.');
      const column = T.columnOf(args.coluna);
      if (!column) throw userSafe('Coluna inválida. Use a_fazer, fazendo, revisao ou feito.');
      const nota = String(args.nota || '')
        .trim()
        .slice(0, 600);
      Object.assign(task, { column, updatedAt: now(), note: nota || task.note });
      if (column === 'review' && args.para) {
        const reviewer = who(args.para);
        task.reviewer = reviewer;
        post(
          t,
          me.id,
          reviewer,
          'review',
          task.id + ' pronta para revisão: ' + task.title + (nota ? ' — ' + nota : '')
        );
      }
      // Sent back: the one who has it hears why.
      if (column === 'todo' && task.assignee !== me.id)
        post(t, me.id, task.assignee, 'review', task.id + ' voltou: ' + (nota || 'veja o quadro.'));
      commit();
      tick();
      return { tarefa: task.id, coluna: T.COLUMN_LABELS[column] };
    }
    throw userSafe('Ferramenta desconhecida: ' + name);
  }

  // ---- Clock -----------------------------------------------------------------------------------------------------
  // At start: nobody is in the middle of a turn anymore; a team that was running waits for the person to continue.
  function recover() {
    let changed = false;
    for (const t of teams()) {
      for (const m of t.members) if (m.busy) (m.busy = false), (changed = true);
      if (t.status === 'running') {
        t.status = 'paused';
        note(t, 'O VeSTA fechou com a equipe trabalhando. Continue quando quiser.');
        changed = true;
      }
    }
    if (changed) store.save();
  }
  let timer = null;
  function startClock() {
    recover();
    timer = (deps.setInterval || setInterval)(tick, Number(process.env.VESTA_TEAM_TICK_MS) || TICK_MS);
    timer?.unref?.();
  }
  function stopClock() {
    if (timer) (deps.clearInterval || clearInterval)(timer);
    timer = null;
  }

  return {
    create,
    update,
    place,
    remove,
    start,
    pause,
    stopAll,
    answer,
    say,
    merge,
    branches,
    tick,
    onChatDone,
    tool,
    recover,
    startClock,
    stopClock,
  };
}

module.exports = { createTeamEngine, TICK_MS };
