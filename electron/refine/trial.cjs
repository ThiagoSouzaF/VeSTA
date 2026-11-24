// Testing a skill proposal before the yes (the evals of Anthropic's skill-creator, small): the version in use and the
// proposal answer the same realistic requests in hidden read-only chats, and a judge that does not know which is
// which says, for each request, which answer did better. For a skill the AI loads on its own ("A IA decide"), the
// description is tested too: with the catalog the AIs see, would it be picked for requests that need it, and left out
// for those that do not, with the description in use and with the proposed one.
//
// proposal.test = { status: 'running' | 'done' | 'error', step, at, endedAt, provider, error,
//                   cases: [{ pedido, esperado, winner: 'proposta' | 'atual' | 'empate', motivo }],
//                   wins: { proposta, atual, empate },
//                   triggers: { total, atual, proposta, misses: [{ pedido, deve, atual, proposta }] } | null }
const { UserError } = require('../app/errors.cjs');
const { redact } = require('../memory/redact.cjs');
const F = require('../skills/format.cjs');
const B = require('./brief.cjs');
const { parseJson } = require('./ask.cjs');

const TRIGGERS = 8;
const CLIP_ANSWER = 4000;

const clip = (t, n) => {
  const v = String(t || '').trim();
  return v.length > n ? v.slice(0, n) + '\n[…]' : v;
};

// ---- Prompts and the reading of the answers (pure) -------------------------------------------------------------------
function planPrompt({ name, text, tests, triggers }) {
  const want = [
    tests
      ? '"testes": 3 pedidos realistas, variados, que a skill deve atender, cada um com "esperado" (o que uma boa resposta faz)'
      : '',
    triggers
      ? '"gatilhos": ' +
        TRIGGERS +
        ' pedidos curtos e realistas, metade que deveria fazer a IA carregar esta skill ("deve": true) e metade parecidos no assunto mas que não precisam dela ("deve": false)'
      : '',
  ].filter(Boolean);
  return [
    'Você prepara um teste da skill /' + name + '. Não execute a skill, não use ferramentas: só responda com JSON.',
    '<skill>\n' + text + '\n</skill>',
    'Devolva um único bloco ```json com ' + want.join(' e ') + '.',
    'Formato: {"testes":[{"pedido":"...","esperado":"..."}],"gatilhos":[{"pedido":"...","deve":true}]}',
  ].join('\n\n');
}
function readPlan(reply, { tests, triggers }) {
  const j = parseJson(reply) || {};
  const out = { tests: tests ? B.cleanTests(j.testes) : [], triggers: [] };
  if (triggers)
    out.triggers = (Array.isArray(j.gatilhos) ? j.gatilhos : [])
      .map((g) => ({
        pedido: String(g?.pedido || '')
          .trim()
          .slice(0, 400),
        deve: g?.deve === true,
      }))
      .filter((g) => g.pedido)
      .slice(0, TRIGGERS);
  return out;
}

// One answer with one version of the skill. Nothing runs: the AI says what it would do.
function trialPrompt(skillText, pedido) {
  return [
    'Você está num teste de uma skill. Siga a skill abaixo para atender ao pedido, como faria de verdade, mas sem mudar nada: não edite arquivos e não rode comandos que alterem algo. Se a skill mandar rodar ou criar algo, mostre exatamente o que faria e o resultado que entregaria.',
    '<skill>\n' + F.parseSkill(skillText).body + '\n</skill>',
    'Pedido: ' + pedido,
  ].join('\n\n');
}

// The judge sees each pair as A and B in an order that does not tell which version is which.
// flips[i] true = the proposal is A.
function judgePrompt(cases, answers, flips) {
  return [
    'Você é um juiz imparcial. Para cada pedido abaixo há duas respostas, A e B, de duas versões de uma mesma skill. Diga qual atende melhor ao pedido e ao que se espera dele (correção, completude, clareza, seguir o que foi pedido). Se forem equivalentes, diga empate. Não use ferramentas.',
    ...cases.map((c, i) => {
      const [a, b] = flips[i] ? [answers[i].proposta, answers[i].atual] : [answers[i].atual, answers[i].proposta];
      return (
        '## Pedido ' +
        (i + 1) +
        '\n' +
        c.pedido +
        (c.esperado ? '\nEsperado: ' + c.esperado : '') +
        '\n### Resposta A\n' +
        clip(a, CLIP_ANSWER) +
        '\n### Resposta B\n' +
        clip(b, CLIP_ANSWER)
      );
    }),
    'Responda só com um bloco ```json: [{"pedido":1,"vencedor":"A|B|empate","motivo":"uma frase"}]',
  ].join('\n\n');
}
function readJudge(reply, cases, flips) {
  const j = parseJson(reply);
  const list = Array.isArray(j) ? j : Array.isArray(j?.resultados) ? j.resultados : [];
  return cases.map((c, i) => {
    const v = list.find((x) => Number(x?.pedido) === i + 1) || list[i] || {};
    const raw = String(v.vencedor || '')
      .trim()
      .toUpperCase();
    const winner =
      raw === 'A' ? (flips[i] ? 'proposta' : 'atual') : raw === 'B' ? (flips[i] ? 'atual' : 'proposta') : 'empate';
    return { pedido: c.pedido, esperado: c.esperado, winner, motivo: String(v.motivo || '').slice(0, 300) };
  });
}

// Would the AI pick this skill? The catalog it sees (name and description of the "A IA decide" skills).
function routePrompt(catalog, triggers) {
  return [
    'Antes de responder a um pedido, você pode carregar uma das skills abaixo (pelo nome) se ela servir para ele; senão, nenhuma. Para cada pedido, diga qual carregaria. Não responda aos pedidos e não use ferramentas.',
    '## Skills disponíveis\n' + catalog.map((s) => '- ' + s.name + ': ' + s.description).join('\n'),
    '## Pedidos\n' + triggers.map((t, i) => i + 1 + '. ' + t.pedido).join('\n'),
    'Responda só com um bloco ```json: [{"pedido":1,"skill":"nome ou null"}]',
  ].join('\n\n');
}
// -> [bool per trigger]: true when the AI did what it should (picked this skill when it should, left it when not).
function readRoute(reply, triggers, name) {
  const j = parseJson(reply);
  const list = Array.isArray(j) ? j : [];
  return triggers.map((t, i) => {
    const v = list.find((x) => Number(x?.pedido) === i + 1) || list[i] || {};
    const picked = String(v.skill || '').replace(/^\//, '') === name;
    return picked === t.deve;
  });
}
const descriptionOf = (text) =>
  String(F.parseSkill(text).data.description || '')
    .replace(/\s+/g, ' ')
    .trim();

// ---- Running ---------------------------------------------------------------------------------------------------------
// deps (tests): { random() } (the A/B order)
function createTrials(ctx, deps = {}) {
  const lib = () => ctx.skills.lib;
  const random = deps.random || Math.random;
  const running = new Set();
  // Written only on the proposal the test started with: one that replaced it meanwhile is not the one tested.
  const set = (name, at, test) => {
    if (lib().get(name)?.proposal?.at !== at) return;
    lib().patchProposal(name, { test });
    ctx.sync?.();
  };

  async function run(name, { provider, model, at }) {
    const meta = lib().get(name);
    const proposalText = lib().readProposal(name);
    const current = lib().read(name).text;
    const ask = (title, text) =>
      ctx.refineAsker.ask({ provider, model, title: 'Teste · /' + name + ' · ' + title }, text);
    const test = { status: 'running', step: 'Preparando os pedidos de teste', at: Date.now(), provider, error: '' };
    set(name, at, test);
    const given = meta.proposal.tests || [];
    const wantTriggers = meta.mode === 'auto';
    let cases = given;
    let triggers = [];
    if (!given.length || wantTriggers) {
      const plan = readPlan(
        await ask('plano', planPrompt({ name, text: proposalText, tests: !given.length, triggers: wantTriggers })),
        { tests: !given.length, triggers: wantTriggers }
      );
      if (!given.length) cases = plan.tests;
      triggers = plan.triggers;
    }
    if (!cases.length) throw new UserError('A IA não preparou pedidos de teste.');

    const answers = [];
    for (let i = 0; i < cases.length; i++) {
      set(name, at, { ...test, step: 'Rodando o pedido ' + (i + 1) + ' de ' + cases.length + ' nas duas versões' });
      const [atual, proposta] = await Promise.all([
        ask('atual', trialPrompt(current, cases[i].pedido)),
        ask('proposta', trialPrompt(proposalText, cases[i].pedido)),
      ]);
      answers.push({ atual, proposta });
    }
    set(name, at, { ...test, step: 'O juiz está comparando as respostas' });
    const flips = cases.map(() => random() < 0.5);
    const judged = readJudge(await ask('juiz', judgePrompt(cases, answers, flips)), cases, flips);
    const wins = { proposta: 0, atual: 0, empate: 0 };
    for (const c of judged) wins[c.winner]++;

    let result = null;
    if (triggers.length) {
      set(name, at, { ...test, step: 'Conferindo se a descrição faz a IA escolher a skill' });
      const others = lib()
        .list()
        .filter((s) => s.name !== name && s.enabled && s.mode === 'auto')
        .map((s) => ({ name: s.name, description: s.description }));
      const before = descriptionOf(current),
        after = descriptionOf(proposalText);
      const route = (desc) =>
        ask('descrição', routePrompt([...others, { name, description: desc }], triggers)).then((r) =>
          readRoute(r, triggers, name)
        );
      const [a, p] = await Promise.all([route(before), before === after ? null : route(after)]);
      const pp = p || a;
      result = {
        total: triggers.length,
        same: before === after,
        atual: a.filter(Boolean).length,
        proposta: pp.filter(Boolean).length,
        misses: triggers
          .map((t, i) => ({ pedido: t.pedido, deve: t.deve, atual: a[i], proposta: pp[i] }))
          .filter((m) => !m.atual || !m.proposta),
      };
    }
    set(name, at, { ...test, status: 'done', step: '', endedAt: Date.now(), cases: judged, wins, triggers: result });
  }

  // Starts the test of the proposal of `name` (runs in the background; the screen follows proposal.test).
  function start({ name, provider, model = '' }) {
    const meta = lib().get(String(name || ''));
    if (!meta) throw new UserError('Skill não encontrada: ' + name);
    if (!meta.proposal) throw new UserError('Não há proposta esperando');
    if (running.has(meta.name)) throw new UserError('Esta proposta já está sendo testada');
    const ai = provider || meta.proposal.provider || 'claude';
    running.add(meta.name);
    const at = meta.proposal.at;
    run(meta.name, { provider: ai, model, at })
      .catch((e) => {
        // The proposal may have been applied or discarded meanwhile: then there is nothing to write on.
        set(meta.name, at, {
          status: 'error',
          step: '',
          at: Date.now(),
          endedAt: Date.now(),
          provider: ai,
          error: redact(String(e.message || e)).slice(0, 400),
        });
      })
      .finally(() => running.delete(meta.name));
    return { started: true };
  }
  // A test the app closed in the middle is marked as failed.
  function recover() {
    for (const s of lib().list())
      if (s.proposal?.test?.status === 'running')
        lib().patchProposal(s.name, {
          test: { ...s.proposal.test, status: 'error', step: '', error: 'O VeSTA fechou durante o teste.' },
        });
  }
  return { start, recover };
}

module.exports = {
  createTrials,
  planPrompt,
  readPlan,
  trialPrompt,
  judgePrompt,
  readJudge,
  routePrompt,
  readRoute,
};
