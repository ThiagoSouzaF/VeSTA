// Refining a skill of the library or an agent of Agent Mode: a chat the person talks to (chat.refine set, mode read,
// with memory) whose first message carries the context out of sight (brief.cjs). The AI proposes through the
// vesta-skills tools; the proposal waits for the person's yes (Aplicar), and every change keeps the version it
// replaces (Versões → Voltar a esta).
// deps (tests): { send(ctx, args), installed(provider), now() }
const { randomUUID } = require('node:crypto');
const { UserError } = require('../app/errors.cjs');
const { PROVIDER_IDS } = require('../shared/agents.cjs');
const A = require('../shared/agents.cjs');
const H = require('../skills/health.cjs');
const B = require('./brief.cjs');

const ORDER = ['claude', 'codex', 'opencode', 'drael'];

function createRefiner(ctx, deps = {}) {
  const store = ctx.store;
  const send = deps.send || ((...a) => require('../chat/send.cjs').send(...a));
  const installed = deps.installed || ((p) => !!ctx.integrations?.[p]?.installed);
  const now = deps.now || Date.now;
  const lib = () => ctx.skills.lib;
  const commit = () => {
    store.save();
    ctx.sync?.();
  };
  const agentOf = (id) => {
    const a = (store.state.agents || []).find((x) => x.id === id);
    if (!a) throw new UserError('Agent não encontrado');
    return a;
  };
  const skillOf = (name) => {
    const meta = lib().get(String(name || ''));
    if (!meta) throw new UserError('Skill não encontrada: ' + name);
    return meta;
  };
  // { kind, name } | { kind, id } -> the same, checked.
  function key(input = {}) {
    if (input.kind === 'skill') return { kind: 'skill', name: skillOf(input.name).name };
    if (input.kind === 'agent') return { kind: 'agent', id: agentOf(input.id).id };
    throw new UserError('Refinar o quê? (skill ou agent)');
  }
  const same = (r, k) => r && r.kind === k.kind && (k.kind === 'skill' ? r.name === k.name : r.id === k.id);
  const label = (k) => (k.kind === 'skill' ? '/' + k.name : agentOf(k.id).name);

  // Everything the AI needs, built fresh each time (first message, vesta_refine_context).
  function brief(k, goal = '') {
    const chats = store.state.chats;
    const memories = store.state.memories || [];
    if (k.kind === 'skill') {
      const meta = skillOf(k.name);
      const text = lib().read(k.name).text;
      const proposal = lib().readProposal(k.name);
      return B.buildBrief(
        { kind: 'skill', name: k.name, text, meta },
        {
          evidence: B.skillEvidence(chats, meta.recent),
          memories: B.relatedMemories(memories, ['/' + k.name, k.name]),
          proposal: proposal ? '```markdown\n' + proposal + '\n```' : null,
          goal,
        }
      );
    }
    const a = agentOf(k.id);
    const project = a.projectId ? store.state.projects.find((p) => p.id === a.projectId) : null;
    return B.buildBrief(
      { kind: 'agent', agent: a, projectName: project?.name || '' },
      {
        evidence: B.agentEvidence(a, chats),
        memories: B.relatedMemories(memories, [a.name]),
        proposal: a.proposal
          ? 'Tarefa:\n```\n' +
            a.proposal.prompt +
            '\n```' +
            (a.proposal.lessons ? '\nLições: ' + a.proposal.lessons.join(' | ') : '')
          : null,
        goal,
      }
    );
  }

  // Opens the refinement chat (or goes on in the one already there) -> { chatId }.
  async function start({ provider, model = '', goal = '', ...input }) {
    const k = key(input);
    goal = String(goal || '').trim();
    const open = store.state.chats.find((c) => same(c.refine, k));
    if (open) {
      if (goal) await send(ctx, { chatId: open.id, text: goal });
      return { chatId: open.id };
    }
    const ai = provider || ORDER.find(installed);
    if (!PROVIDER_IDS.includes(ai)) throw new UserError('Escolha a IA que vai refinar');
    if (!installed(ai)) throw new UserError('Essa IA não está instalada (tela Conexões)');
    const a = k.kind === 'agent' ? agentOf(k.id) : null;
    const chat = store.addChat({ provider: ai, model, projectId: a?.projectId || null, mode: 'read', memory: true });
    chat.title = ('Refinar ' + (k.kind === 'skill' ? '/' + k.name : 'agent ' + a.name)).slice(0, 100);
    chat.refine = k;
    commit();
    const shown =
      goal || 'Analise ' + (k.kind === 'skill' ? 'a skill /' + k.name : 'o agent ' + a.name) + ' e proponha melhorias.';
    try {
      await send(ctx, {
        chatId: chat.id,
        text: shown,
        brief: {
          text: brief(k, goal),
          note: {
            kind: 'skill',
            label: 'Contexto do refino carregado',
            detail: k.kind === 'skill' ? 'Texto, usos recentes e memória.' : 'Tarefa, execuções, lições e memória.',
          },
        },
      });
    } catch (e) {
      // The turn never started: the empty chat goes too.
      store.state.chats = store.state.chats.filter((c) => c !== chat);
      commit();
      throw e;
    }
    return { chatId: chat.id };
  }

  // ---- What the AI calls (vesta-skills, refinement chats only) ---------------------------------------------------
  const context = (chat) => ({ alvo: label(key(chat.refine)), contexto: brief(key(chat.refine)) });
  function propose(chat, args) {
    const k = key(chat.refine);
    if (k.kind === 'skill') {
      const p = B.checkProposal('skill', args, { name: k.name });
      const others = lib()
        .list()
        .filter((s) => s.name !== k.name)
        .map((s) => ({ name: s.name, description: s.description }));
      const health = H.checkSkill({ name: k.name, text: p.text, files: [] }, { others });
      const risks = health.filter((h) => h.level === 'risk');
      if (risks.length)
        throw Object.assign(new Error('Proposta recusada: ' + risks.map((h) => h.text).join('; ')), { userSafe: true });
      lib().setProposal(k.name, { ...p, chatId: chat.id, provider: chat.provider });
      ctx.sync?.();
      return {
        guardada: true,
        avisos: health.map((h) => h.text),
        proximo: 'A pessoa vê as diferenças e aplica na tela Skills ou na barra deste chat.',
      };
    }
    const a = agentOf(k.id);
    const p = B.checkProposal('agent', args);
    a.proposal = { ...p, at: now(), chatId: chat.id, provider: chat.provider };
    commit();
    return { guardada: true, proximo: 'A pessoa vê as diferenças e aplica no Agent Mode ou na barra deste chat.' };
  }

  // ---- What the person does --------------------------------------------------------------------------------------
  function proposal(input) {
    const k = key(input);
    if (k.kind === 'agent') return agentOf(k.id).proposal || null;
    const text = lib().readProposal(k.name);
    if (!text) return null;
    const meta = skillOf(k.name);
    return { ...meta.proposal, text, current: lib().read(k.name).text };
  }
  function apply(input) {
    const k = key(input);
    if (k.kind === 'skill') {
      const text = lib().readProposal(k.name);
      if (!text) throw new UserError('Não há proposta esperando');
      const changes = skillOf(k.name).proposal?.changes || [];
      lib().update(k.name, { text, note: 'Antes do refino: ' + (changes[0] || 'proposta da IA') });
      lib().clearProposal(k.name);
      ctx.sync?.();
      return;
    }
    const a = agentOf(k.id);
    const p = a.proposal;
    if (!p) throw new UserError('Não há proposta esperando');
    ctx.agents.keepVersion(a, 'Antes do refino: ' + (p.changes[0] || 'proposta da IA'));
    a.prompt = A.normalizeAgent({ ...a, prompt: p.prompt }).prompt;
    if (p.lessons) setKept(a, p.lessons);
    Object.assign(a, { proposal: null, updatedAt: now() });
    commit();
  }
  function setKept(a, texts) {
    const rest = (a.lessons || []).filter((l) => l.status !== 'kept' && !texts.some((t) => A.sameLesson(t, l.text)));
    const kept = texts.map((text) => ({
      id: randomUUID(),
      text,
      status: 'kept',
      from: 'refine',
      at: now(),
      runId: null,
    }));
    a.lessons = [...kept, ...rest].slice(0, A.MAX_LESSONS);
  }
  function discard(input) {
    const k = key(input);
    if (k.kind === 'skill') lib().clearProposal(k.name);
    else agentOf(k.id).proposal = null;
    commit();
  }
  function restore({ n, ...input }) {
    const k = key(input);
    const note = 'Antes de voltar à versão ' + n;
    if (k.kind === 'skill') {
      lib().update(k.name, { text: lib().readVersion(k.name, n), note });
      ctx.sync?.();
      return;
    }
    const a = agentOf(k.id);
    const v = (a.versions || []).find((x) => x.n === Number(n));
    if (!v) throw new UserError('Versão não encontrada');
    ctx.agents.keepVersion(a, note);
    a.prompt = v.prompt;
    setKept(a, v.lessons || []);
    a.updatedAt = now();
    commit();
  }
  const version = ({ name, n }) => ({ text: lib().readVersion(skillOf(name).name, n) });

  return { start, brief, context, propose, proposal, apply, discard, restore, version };
}

module.exports = { createRefiner };
