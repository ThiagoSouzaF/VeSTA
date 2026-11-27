// The automatic review (Refino automático): on its schedule, or by "Revisar agora", the skills and agents whose
// signals (shared/refine.cjs: corrections, errors, failed runs, lessons waiting) call for it go, the most urgent first
// and at most `perRun` per pass, to the AI the person picked, in a hidden chat with the same context a refinement
// chat gets plus the rules of a review nobody watches. What it proposes waits for the person like any proposal;
// either way the item counts as reviewed, so the same signals do not bring it back.
//
// state.refineAuto = { enabled, provider, model, schedule (shared/agents.cjs), perRun, nextRunAt, runs: [Run] }
// Run { id, at, endedAt, trigger: 'manual' | 'schedule', provider, status: 'running' | 'ok' | 'error', reviewed,
//       proposed, items: [{ kind, name, label, proposed }], error }
// deps (tests): { now(), setInterval, clearInterval, installed(provider) }
const { randomUUID } = require('node:crypto');
const { UserError } = require('../app/errors.cjs');
const { redact } = require('../memory/redact.cjs');
const A = require('../shared/agents.cjs');
const R = require('../shared/refine.cjs');
const B = require('./brief.cjs');
const { clock } = require('../util/clock.cjs');

const TICK_MS = 60000;
const MAX_RUNS = 10;
const PER_RUN = [1, 2, 3, 5];
const PROVIDERS = A.PROVIDER_IDS;

function normalizeAuto(input) {
  input ||= {};
  let schedule;
  try {
    schedule = A.normalizeSchedule(input.schedule || { kind: 'daily', time: '04:00' });
  } catch {
    schedule = A.normalizeSchedule({ kind: 'daily', time: '04:00' });
  }
  return {
    enabled: input.enabled === true,
    provider: PROVIDERS.includes(input.provider) ? input.provider : 'claude',
    model: String(input.model || '').slice(0, 120),
    schedule,
    perRun: PER_RUN.includes(Number(input.perRun)) ? Number(input.perRun) : 3,
    nextRunAt: Number(input.nextRunAt) || null,
    runs: Array.isArray(input.runs) ? input.runs.slice(0, MAX_RUNS) : [],
  };
}

function createAutoRefiner(ctx, deps = {}) {
  const store = ctx.store;
  const state = () => store.state;
  const now = deps.now || Date.now;
  const installed = deps.installed || ((p) => !!ctx.integrations?.[p]?.installed);
  const probed = (p) => !!deps.installed || ctx.integrations?.[p] !== undefined;
  const cfg = () => (state().refineAuto ||= normalizeAuto());
  let current = null;
  const commit = () => {
    store.save();
    ctx.sync?.();
  };
  const schedule = () => {
    cfg().nextRunAt = cfg().enabled ? A.nextRun(cfg().schedule, now()) : null;
  };
  const list = () =>
    R.candidates({ skills: ctx.skills.lib.list(), agents: state().agents || [], chats: state().chats });

  function configure({ enabled, provider, model, schedule: sch, perRun } = {}) {
    const c = cfg();
    if (provider !== undefined) {
      if (!PROVIDERS.includes(provider)) throw new UserError('Escolha a IA que vai revisar');
      Object.assign(c, { provider, model: provider === c.provider ? c.model : '' });
    }
    if (model !== undefined) c.model = String(model || '').slice(0, 120);
    if (sch !== undefined) c.schedule = A.normalizeSchedule(sch);
    if (perRun !== undefined) c.perRun = PER_RUN.includes(Number(perRun)) ? Number(perRun) : c.perRun;
    if (enabled !== undefined) c.enabled = !!enabled;
    schedule();
    commit();
  }

  async function review(item, run) {
    const k = ctx.refiner.key(item);
    const had = proposalOf(k);
    const agent = k.kind === 'agent' ? (state().agents || []).find((a) => a.id === k.id) : null;
    await ctx.refineAsker.ask(
      {
        provider: run.provider,
        model: cfg().model,
        projectId: agent?.projectId || null,
        refine: k,
        title: 'Revisão automática · ' + item.label,
      },
      ctx.refiner.brief(k) + '\n\n' + B.AUTO
    );
    const proposed = !!proposalOf(k) && proposalOf(k) !== had;
    ctx.refiner.reviewed(k);
    run.items.push({ kind: k.kind, name: item.label, proposed });
    run.reviewed++;
    if (proposed) run.proposed++;
    commit();
  }
  const proposalOf = (k) =>
    k.kind === 'skill'
      ? ctx.skills.lib.get(k.name)?.proposal?.at || null
      : (state().agents || []).find((a) => a.id === k.id)?.proposal?.at || null;

  function run(trigger) {
    if (current) throw new UserError('A revisão automática já está rodando');
    const c = cfg();
    const items = list().slice(0, c.perRun);
    if (!items.length) {
      if (trigger === 'manual')
        throw new UserError('Nada para revisar: nenhuma skill ou agent com sinal de problema desde a última revisão');
      return null;
    }
    if (!installed(c.provider)) throw new UserError('A IA escolhida não está instalada (tela Conexões)');
    const r = {
      id: randomUUID(),
      at: now(),
      endedAt: null,
      trigger,
      provider: c.provider,
      status: 'running',
      reviewed: 0,
      proposed: 0,
      items: [],
      error: '',
    };
    c.runs = [r, ...c.runs].slice(0, MAX_RUNS);
    commit();
    current = (async () => {
      for (const item of items)
        try {
          await review(item, r);
        } catch (e) {
          return Object.assign(r, { status: 'error', error: redact(String(e.message || e)).slice(0, 400) });
        }
      r.status = 'ok';
    })().finally(() => {
      r.endedAt = now();
      current = null;
      commit();
    });
    return r.id;
  }
  const runNow = () => ({ runId: run('manual') });
  const idle = () => current || Promise.resolve();

  function tick() {
    const c = cfg();
    if (current || !c.enabled || !c.nextRunAt || c.nextRunAt > now() || !probed(c.provider)) return;
    schedule();
    try {
      if (!run('schedule')) commit();
    } catch (e) {
      const t = now();
      c.runs = [
        {
          id: randomUUID(),
          at: t,
          endedAt: t,
          trigger: 'schedule',
          provider: c.provider,
          status: 'error',
          reviewed: 0,
          proposed: 0,
          items: [],
          error: e.message,
        },
        ...c.runs,
      ].slice(0, MAX_RUNS);
      commit();
    }
  }
  function recover() {
    state().refineAuto = normalizeAuto(state().refineAuto);
    for (const r of cfg().runs)
      if (r.status === 'running')
        Object.assign(r, { status: 'error', endedAt: now(), error: 'O VeSTA fechou durante a revisão.' });
    if (!cfg().nextRunAt) schedule();
  }
  const { startClock, stopClock } = clock(tick, { ms: TICK_MS, env: 'VESTA_REFINE_TICK_MS', first: recover, deps });

  return { configure, runNow, tick, recover, idle, startClock, stopClock, candidates: list };
}

module.exports = { createAutoRefiner, normalizeAuto, PER_RUN };
