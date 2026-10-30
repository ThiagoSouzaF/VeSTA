const { randomUUID } = require('node:crypto');
const { UserError } = require('../app/errors.cjs');
const Q = require('./model.cjs');
const T = require('./tools.cjs');
const { redact } = require('../memory/redact.cjs');

// The quest engine: glue between the pure model (quests.cjs) and the rest of the main process. It reacts to the
// 'chat-done' event of the bus and starts step chats through the regular `send` flow (no duplicated spawn logic).
// `deps` (all optional, for tests) = { send(ctx, args), now(), memory() }.
function createQuestEngine(ctx, deps = {}) {
  const store = ctx.store;
  const send = deps.send || require('../chat/send.cjs').send;
  const now = deps.now || Date.now;
  const quests = () => store.state.quests;
  const find = (id) => {
    const q = quests().find((x) => x.id === id);
    if (!q) throw new UserError('Quest não encontrada');
    return q;
  };
  const commit = () => {
    store.save();
    ctx.sync();
  };
  // AIs that can take part, with the models the app knows for each.
  const installed = () => {
    const out = {};
    for (const p of Q.PROVIDER_IDS)
      if (ctx.integrations[p]?.installed) out[p] = { models: ctx.integrations[p].models || [] };
    return out;
  };
  const newChat = (input, title, extra) => {
    const chat = store.addChat(input);
    chat.title = title.slice(0, 100);
    Object.assign(chat, extra);
    return chat;
  };
  const assistantOf = (chat) => [...chat.messages].reverse().find((m) => m.role === 'assistant');
  // The quest's own chat (read-only, outside the shared memory). Quests from before it existed promote their planning
  // chat; otherwise a new one is opened with the given AI, or the first installed one.
  const leadOf = (q) => (q.leadChatId ? store.state.chats.find((c) => c.id === q.leadChatId) : undefined);
  function ensureLead(q, provider, model = '') {
    let chat = leadOf(q);
    if (chat && (!provider || chat.provider === provider)) return chat;
    if (!chat && !provider && q.planning?.chatId) chat = store.state.chats.find((c) => c.id === q.planning.chatId);
    if (chat && !provider) {
      chat.questRole = 'lead';
      q.leadChatId = chat.id;
      return chat;
    }
    provider ||= Q.PROVIDER_IDS.find((p) => ctx.integrations[p]?.installed);
    if (!provider) throw new UserError('Instale uma IA na tela Conexões para conversar sobre a quest');
    chat = newChat({ provider, model, projectId: q.projectId, mode: 'read', memory: false }, 'Quest: ' + q.title, {
      questId: q.id,
      questRole: 'lead',
    });
    q.leadChatId = chat.id;
    return chat;
  }

  // ---- Scheduling -----------------------------------------------------------------------------------------------
  function startStep(q, s) {
    let chat;
    try {
      chat = newChat(
        { provider: s.provider, model: s.model, projectId: q.projectId, mode: s.mode, memory: true },
        'Quest: ' + q.title + ' — ' + s.title,
        { questId: q.id, stepId: s.id }
      );
    } catch (e) {
      Q.failStep(q, s.id, e.message, now());
      return;
    }
    Q.beginStep(q, s.id, chat.id, now());
    const prompt = Q.buildStepPrompt(q, s);
    Promise.resolve()
      .then(() => send(ctx, { chatId: chat.id, text: prompt }))
      .catch((e) => {
        // The turn never started (no CLI, project gone...): there will be no 'chat-done'.
        const cur = Q.step(q, s.id);
        if (cur?.status === 'running' && cur.chatId === chat.id) {
          Q.failStep(q, s.id, redact(e.message), now());
          advance(q);
          commit();
        }
      });
  }
  // Starts everything that is ready (within maxParallel), then settles the quest status.
  function advance(q) {
    for (let guard = 0; guard < Q.MAX_STEPS + 2; guard++) {
      const [s] = Q.readySteps(q);
      if (!s) break;
      startStep(q, s);
    }
    Q.evaluate(q, now());
  }

  // ---- Reactions ------------------------------------------------------------------------------------------------
  async function remember(q, s) {
    const memory = deps.memory ? deps.memory() : ctx.memory;
    if (!memory || !store.state.settings.memoryEnabled) return;
    try {
      await memory.ensureProject?.(q.projectId);
      const note = {
        id: randomUUID(),
        path: 'quests/' + q.id + '/' + s.id + '.md',
        title: 'Quest: ' + q.title + ' — ' + s.title,
        kind: 'quest',
        projectId: q.projectId,
        chatId: s.chatId,
        body: redact('IA: ' + s.provider + (s.model ? ' (' + s.model + ')' : '') + '\n\n' + s.result),
        createdAt: now(),
      };
      await memory.write(note);
      store.state.memories = store.state.memories.filter((n) => n.path !== note.path);
      store.state.memories.unshift(note);
      commit();
    } catch (e) {
      Q.addLog(q, 'Memória indisponível para "' + s.title + '": ' + redact(e.message).slice(0, 120), now());
      commit();
    }
  }
  function onPlanDone(q, chat, status) {
    const reply = assistantOf(chat);
    const planning = { ...q.planning };
    if (q.status !== 'draft') return;
    if (status !== 'done' || !reply?.text) {
      q.planning = { ...planning, status: 'error', error: reply?.error || 'O planejamento não terminou.' };
      Q.addLog(q, 'Falha no planejamento: ' + q.planning.error, now());
      return;
    }
    const plan = Q.parsePlan(reply.text, installed());
    if (!plan.ok) {
      q.planning = { ...planning, status: 'error', error: plan.error };
      Q.addLog(q, 'Plano inválido: ' + plan.error, now());
      return;
    }
    q.steps = plan.steps;
    q.planning = { ...planning, status: 'done', error: null, warnings: plan.warnings };
    Q.addLog(q, 'Plano pronto: ' + plan.steps.length + ' etapa(s). Revise e inicie.', now());
  }
  // Called for every finished turn; only chats that belong to a quest matter.
  function onChatDone({ chatId, status }) {
    const chat = store.state.chats.find((c) => c.id === chatId);
    if (!chat?.questId) return;
    const q = quests().find((x) => x.id === chat.questId);
    if (!q) return;
    if (chat.questRole === 'plan' || chat.questRole === 'lead') {
      if (q.planning?.chatId === chatId && q.planning.status === 'running') {
        onPlanDone(q, chat, status);
        Q.touch(q, now());
        commit();
      }
      return;
    }
    const s = q.steps.find((x) => x.id === chat.stepId && x.chatId === chatId);
    if (!s || s.status !== 'running') return; // cancelled, retried or skipped meanwhile
    const reply = assistantOf(chat);
    if (status === 'done') {
      Q.finishStep(q, s.id, Q.extractResult(reply?.text || ''), now());
      remember(q, s);
    } else {
      Q.failStep(
        q,
        s.id,
        status === 'cancelled' ? 'A resposta foi interrompida.' : reply?.error || 'A IA falhou.',
        now()
      );
    }
    advance(q);
    commit();
  }

  // ---- Operations (the IPC methods) -----------------------------------------------------------------------------
  const apply = (q, input) => {
    if (input.title !== undefined) q.title = String(input.title).trim().slice(0, 120) || q.title;
    if (input.goal !== undefined) q.goal = String(input.goal).trim().slice(0, 8000);
    if (input.guidelines !== undefined) q.guidelines = String(input.guidelines).trim().slice(0, 8000);
    if (input.projectId !== undefined) {
      if (input.projectId && !ctx.project(input.projectId)) throw new UserError('Projeto inválido');
      q.projectId = input.projectId || null;
    }
    if (input.maxParallel !== undefined)
      q.maxParallel = Q.normalizeQuest({ maxParallel: input.maxParallel }).maxParallel;
    if (input.steps !== undefined) {
      if (q.status !== 'draft') throw new UserError('O plano só pode ser editado antes de iniciar');
      const steps = Q.normalizeSteps(input.steps).map((s) => ({
        ...s,
        status: 'pending',
        chatId: null,
        result: '',
        startedAt: null,
        endedAt: null,
        attempts: 0,
      }));
      const err = steps.length ? Q.validateSteps(steps) : null;
      if (err) throw new UserError(err);
      q.steps = steps;
    }
    Q.touch(q, now());
  };
  function plan(q, { provider, model }) {
    if (!ctx.integrations[provider]?.installed) throw new UserError('Esta IA não está instalada. Confira as Conexões.');
    if (!q.goal) throw new UserError('Descreva o objetivo para planejar');
    // The idea arrives in the quest's own chat: the planning turn is its first message.
    const chat = ensureLead(q, provider, model || '');
    if (ctx.jobs.has(chat.id)) throw new UserError('O chat da quest está respondendo; aguarde ou pare a resposta');
    if (model !== undefined && chat.model !== (model || '') && !chat.messages.length) chat.model = model || '';
    q.planning = { chatId: chat.id, provider, status: 'running', error: null, startedAt: now() };
    Q.addLog(q, 'Planejando com ' + provider + '…', now());
    Promise.resolve()
      .then(() => send(ctx, { chatId: chat.id, text: Q.buildPlanPrompt(q, installed()) }))
      .catch((e) => {
        if (q.planning?.chatId === chat.id && q.planning.status === 'running') {
          q.planning = { ...q.planning, status: 'error', error: redact(e.message) };
          Q.addLog(q, 'Falha no planejamento: ' + redact(e.message), now());
          commit();
        }
      });
  }
  const stop = (chatId) => ctx.stopChat(chatId);
  return {
    onChatDone,
    // Extra context for a message sent in the quest's own chat (null for any other chat, and for the planning turn,
    // whose prompt already carries the quest).
    brief(chat, { tools = true } = {}) {
      if (chat?.questRole !== 'lead') return null;
      const q = quests().find((x) => x.id === chat.questId);
      if (!q || (q.planning?.status === 'running' && q.planning.chatId === chat.id)) return null;
      return Q.buildLeadBrief(q, (id) => store.state.chats.find((c) => c.id === id), { tools });
    },
    // Opens (creating if needed) the quest's own chat; returns its id.
    questChat({ id }) {
      const q = find(id);
      const chat = ensureLead(q);
      commit();
      return chat.id;
    },
    // App (re)opened: nothing may stay stuck in "running".
    recover() {
      let changed = false;
      for (const q of quests()) changed = Q.reconcile(q, [...ctx.jobs.keys()], now()) || changed;
      if (changed) commit();
      return changed;
    },
    createQuest(input) {
      const title = String(input.title || '').trim();
      if (!title) throw new UserError('Dê um título à quest');
      const q = Q.normalizeQuest({ id: randomUUID(), title, status: 'draft', createdAt: now(), updatedAt: now() });
      apply(q, {
        goal: input.goal ?? '',
        guidelines: input.guidelines ?? '',
        projectId: input.projectId,
        maxParallel: input.maxParallel,
      });
      if (input.steps?.length) apply(q, { steps: input.steps });
      if (!q.goal && !q.steps.length) throw new UserError('Descreva o objetivo da quest');
      Q.addLog(q, 'Quest criada.', now());
      if (input.plan) plan(q, input.plan);
      else
        try {
          ensureLead(q);
        } catch {} // no AI installed yet: the chat is opened later, from the quest screen
      quests().unshift(q);
      commit();
      return q;
    },
    updateQuest({ id, ...patch }) {
      const q = find(id);
      if (q.status === 'done' || q.status === 'cancelled') throw new UserError('Esta quest já terminou');
      apply(q, patch);
      commit();
      return q;
    },
    replan({ id, provider, model }) {
      const q = find(id);
      if (q.status !== 'draft') throw new UserError('Só dá para planejar antes de iniciar');
      if (q.planning?.status === 'running') throw new UserError('O planejamento já está em andamento');
      plan(q, { provider, model });
      commit();
      return q;
    },
    startQuest({ id, ...patch }) {
      const q = find(id);
      if (q.planning?.status === 'running') throw new UserError('Aguarde o planejamento terminar');
      apply(q, patch);
      Q.start(q, now());
      advance(q);
      commit();
      return q;
    },
    pauseQuest({ id }) {
      const q = find(id);
      Q.pause(q, now());
      commit();
      return q;
    },
    resumeQuest({ id }) {
      const q = find(id);
      Q.resume(q, now());
      advance(q);
      commit();
      return q;
    },
    cancelQuest({ id }) {
      const q = find(id);
      if (q.planning?.status === 'running') {
        stop(q.planning.chatId);
        q.planning = { ...q.planning, status: 'error', error: 'Cancelado.' };
      }
      for (const chatId of Q.cancel(q, now())) stop(chatId);
      commit();
      return q;
    },
    retryStep({ id, stepId }) {
      const q = find(id);
      Q.retryStep(q, stepId, now());
      advance(q);
      commit();
      return q;
    },
    skipStep({ id, stepId }) {
      const q = find(id);
      Q.skipStep(q, stepId, now());
      advance(q);
      commit();
      return q;
    },
    // ---- Plan edits while the quest lives. `by` (optional) = who asked, for the journal. -------------------------------
    updateStep({ id, stepId, by, ...patch }) {
      const q = find(id);
      Q.updateStep(q, stepId, patch, installed(), now(), by);
      if (q.status === 'running') advance(q);
      Q.touch(q, now());
      commit();
      return q;
    },
    addStep({ id, by, ...input }) {
      const q = find(id);
      Q.addStep(q, input, installed(), now(), by);
      if (q.status === 'running') advance(q);
      commit();
      return q;
    },
    removeStep({ id, stepId, by }) {
      const q = find(id);
      Q.removeStep(q, stepId, now(), by);
      if (q.status === 'running') advance(q);
      commit();
      return q;
    },
    // ---- What the quest chat (vesta-quest MCP) can see and do. Every call is bound to ONE quest id, which the server
    // takes from the calling chat, never from the model; chats and steps outside it are refused. --------------------
    installed,
    log({ id, text }) {
      const q = find(id);
      Q.addLog(q, text, now());
      commit();
    },
    questState({ id }) {
      const q = find(id),
        p = Q.progress(q);
      return {
        id: q.id,
        titulo: q.title,
        situacao: q.status,
        motivoPausa: q.pauseReason,
        objetivo: q.goal,
        diretrizes: q.guidelines,
        maxParalelo: q.maxParallel,
        progresso: p.done + '/' + p.total + ' etapas',
        iasDisponiveis: installed(),
        planejamento: q.planning ? { status: q.planning.status, erro: q.planning.error || null } : null,
        etapas: q.steps.map((s) => ({
          id: s.id,
          titulo: s.title,
          tipo: s.kind,
          status: s.status,
          ia: s.provider,
          modelo: s.model,
          modo: s.mode,
          dependeDe: s.dependsOn,
          chatId: s.chatId,
          tentativas: s.attempts,
          respondendo: !!s.chatId && ctx.jobs.has(s.chatId),
          instrucoes: s.instructions,
          resultado: s.result,
        })),
        resumo: q.summary || null,
        diario: q.log.slice(-15).map((e) => new Date(e.at).toISOString().slice(11, 19) + ' ' + e.text),
      };
    },
    // Step (by id) or chat (by id) of THIS quest; anything else is refused.
    stepChat({ id, stepId, chatId }) {
      const q = find(id);
      let s = null;
      if (stepId) {
        s = Q.step(q, String(stepId));
        if (!s) throw new UserError('Etapa não encontrada nesta quest: ' + stepId);
      } else if (chatId) {
        s = q.steps.find((x) => x.chatId === String(chatId));
        if (!s) throw new UserError('Esse chat não pertence a nenhuma etapa desta quest');
      } else throw new UserError('Informe stepId ou chatId');
      if (!s.chatId) throw new UserError('A etapa "' + s.title + '" ainda não começou: não há chat');
      const chat = store.state.chats.find((c) => c.id === s.chatId);
      if (!chat) throw new UserError('O chat da etapa "' + s.title + '" não existe mais');
      return { q, step: s, chat };
    },
    chatRead({ id, stepId, chatId, ...cursor }) {
      const { step: s, chat } = this.stepChat({ id, stepId, chatId });
      return { etapa: s.id, ...T.readChat(chat, { ...cursor, live: ctx.jobs.has(chat.id) }) };
    },
    async chatSend({ id, stepId, text }) {
      const { q, step: s, chat } = this.stepChat({ id, stepId });
      if (ctx.jobs.has(chat.id))
        throw new UserError(
          'O chat da etapa "' + s.title + '" está respondendo agora; espere terminar ou use chat_stop'
        );
      await send(ctx, { chatId: chat.id, text });
      Q.addLog(q, 'Mensagem enviada ao chat da etapa "' + s.title + '" (chat da quest).', now());
      commit();
      return { etapa: s.id, chatId: chat.id, enviada: true };
    },
    activity({ id }) {
      const q = find(id);
      const out = [];
      for (const s of q.steps) {
        const chat = s.chatId && store.state.chats.find((c) => c.id === s.chatId);
        if (!chat) continue;
        const live = ctx.jobs.has(chat.id);
        const tarefas = T.runningTasks(chat, live);
        if (live || tarefas.length)
          out.push({ etapa: s.id, titulo: s.title, chatId: chat.id, respondendo: live, tarefas });
      }
      return { situacao: q.status, chats: out };
    },
    stopTask({ id, chatId, taskId }) {
      const { q, step: s } = this.stepChat({ id, chatId });
      if (!ctx.stopTask?.(s.chatId, String(taskId || '')))
        throw new UserError('Esta tarefa não pode mais ser interrompida (ela já terminou ou o CLI não permite)');
      Q.addLog(q, 'Tarefa encerrada no chat da etapa "' + s.title + '" (chat da quest).', now());
      commit();
      return { etapa: s.id, tarefa: String(taskId), encerrada: true };
    },
    stopStepChat({ id, stepId }) {
      const { q, step: s, chat } = this.stepChat({ id, stepId });
      if (!stop(chat.id)) throw new UserError('O chat da etapa "' + s.title + '" não está respondendo');
      Q.addLog(q, 'Resposta da etapa "' + s.title + '" interrompida (chat da quest).', now());
      commit();
      return { etapa: s.id, interrompida: true };
    },
    deleteQuest({ id }) {
      const q = find(id);
      if (q.status === 'running' || q.planning?.status === 'running')
        throw new UserError('Cancele a quest antes de excluir');
      store.state.quests = quests().filter((x) => x.id !== id);
      commit();
    },
  };
}
module.exports = { createQuestEngine };
