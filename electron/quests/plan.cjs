// What the AIs read and write around a quest: the planning prompt and the parser of the plan they answer, each
// step's prompt (with the results its dependencies hand over) and the result taken from a step's answer.
const {
  MAX_RESULT,
  MAX_STEPS,
  PROVIDER_IDS,
  STRENGTHS,
  cycleIds,
  normalizeStep,
  step,
  text,
  topoSort,
  validateSteps,
} = require('../shared/quests.cjs');

// ---- Plan parser -------------------------------------------------------------------------------------------------
// Candidate JSON texts of an AI reply: fenced blocks (```json first), then the widest {...} / [...] span.
function jsonCandidates(raw) {
  const out = [],
    t = String(raw || '');
  const re = /```([a-zA-Z]*)\s*\n([\s\S]*?)```/g;
  let m;
  const fenced = [];
  while ((m = re.exec(t))) fenced.push({ lang: m[1].toLowerCase(), body: m[2] });
  fenced.sort((a, b) => (b.lang === 'json') - (a.lang === 'json'));
  for (const f of fenced) out.push(f.body);
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ]) {
    const a = t.indexOf(open),
      b = t.lastIndexOf(close);
    if (a >= 0 && b > a) out.push(t.slice(a, b + 1));
  }
  return out;
}
function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {}
  try {
    // Tolerate trailing commas, the most common slip.
    return JSON.parse(s.replace(/,\s*([\]}])/g, '$1'));
  } catch {
    return undefined;
  }
}
// Reply of the planning AI -> { ok, steps, warnings, error }. `installed` = { provider: { models?: [] } } of the
// usable AIs; steps naming another AI fall back to the first installed one.
function parsePlan(reply, installed = {}) {
  let list = null;
  for (const c of jsonCandidates(reply)) {
    const v = tryParse(c);
    const arr = Array.isArray(v) ? v : Array.isArray(v?.steps) ? v.steps : Array.isArray(v?.etapas) ? v.etapas : null;
    if (arr && arr.length) {
      list = arr;
      break;
    }
  }
  if (!list) return { ok: false, steps: [], warnings: [], error: 'A IA não devolveu um plano em JSON.' };
  const warnings = [];
  const usable = PROVIDER_IDS.filter((p) => installed[p]);
  const fallback = usable[0] || 'claude';
  if (list.length > MAX_STEPS)
    warnings.push('O plano tinha ' + list.length + ' etapas; mantive as primeiras ' + MAX_STEPS + '.');
  list = list.slice(0, MAX_STEPS).filter((s) => s && typeof s === 'object');
  // The AI names steps by its own keys ("s1", "impl", or a 1-based number): map them to ours.
  const keyOf = (s, i) => String(s.id ?? s.key ?? s.ref ?? i + 1);
  const keys = new Map(list.map((s, i) => [keyOf(s, i), 's' + (i + 1)]));
  const steps = list.map((s, i) => {
    let provider = String(s.provider || s.ia || '').toLowerCase();
    if (provider === 'chatgpt' || provider === 'openai') provider = 'codex';
    if (!installed[provider] && usable.length) {
      if (provider)
        warnings.push(
          '"' + (s.title || 'Etapa ' + (i + 1)) + '": ' + provider + ' indisponível, usando ' + fallback + '.'
        );
      provider = fallback;
    }
    const models = installed[provider]?.models;
    let model = text(s.model, 120);
    if (model && Array.isArray(models) && models.length && !models.includes(model)) model = '';
    const deps = Array.isArray(s.dependsOn ?? s.depends_on ?? s.deps) ? (s.dependsOn ?? s.depends_on ?? s.deps) : [];
    return normalizeStep(
      {
        ...s,
        id: 's' + (i + 1),
        provider,
        model,
        kind: s.kind === 'review' || s.tipo === 'review' ? 'review' : 'work',
        dependsOn: deps.map((d) => keys.get(String(d))).filter((d) => d && d !== 's' + (i + 1)),
        status: 'pending',
      },
      i
    );
  });
  const cyc = cycleIds(steps);
  if (cyc.length)
    return { ok: false, steps: [], warnings, error: 'O plano tem dependências em ciclo (' + cyc.join(', ') + ').' };
  const sorted = topoSort(steps);
  const err = validateSteps(sorted);
  if (err) return { ok: false, steps: [], warnings, error: 'Plano inválido: ' + err };
  return { ok: true, steps: sorted, warnings, error: null };
}

// ---- Prompts -----------------------------------------------------------------------------------------------------
// What the planning AI receives. `installed` = { provider: { models? } }.
function buildPlanPrompt(quest, installed = {}) {
  const lines = PROVIDER_IDS.filter((p) => installed[p]).map((p) => {
    const models = (installed[p].models || []).slice(0, 8).join(', ');
    return '- ' + p + ': ' + STRENGTHS[p] + (models ? ' (modelos: ' + models + ')' : '');
  });
  return [
    'Você é o planejador de uma "quest" no VeSTA: várias IAs trabalham juntas num objetivo. Não edite nada; só planeje.',
    '## Objetivo\n' + quest.goal,
    quest.guidelines ? '## Diretrizes\n' + quest.guidelines : '',
    '## IAs disponíveis (use apenas estas)\n' + lines.join('\n'),
    '## Como planejar\n' +
      '- No máximo ' +
      MAX_STEPS +
      ' etapas, cada uma pequena, verificável e com instruções completas (a IA da etapa não vê esta conversa).\n' +
      '- Use "dependsOn" para etapas que precisam do resultado de outras; etapas independentes rodam em paralelo.\n' +
      '- Quando fizer sentido, inclua uma etapa kind "review" feita por uma IA DIFERENTE da que implementou, em mode "read" ou "edit" conforme precise corrigir.\n' +
      '- "mode": "edit" (pode editar arquivos) ou "read" (só consulta). "model" pode ficar vazio (padrão da conta).\n' +
      '- Os resultados das etapas anteriores chegam às seguintes automaticamente.',
    '## Formato\nResponda com uma frase curta e UM bloco ```json exatamente neste formato:\n' +
      '```json\n{"steps":[{"id":"s1","title":"...","instructions":"...","provider":"claude","model":"","mode":"edit","kind":"work","dependsOn":[]},{"id":"s2","title":"Revisar","instructions":"...","provider":"codex","model":"","mode":"read","kind":"review","dependsOn":["s1"]}]}\n```',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Result handed to the next steps: the "## Resultado" section of the reply, else the end of the text.
function extractResult(reply, max = MAX_RESULT) {
  const t = String(reply || '').replace(/\r\n/g, '\n');
  const lines = t.split('\n');
  let start = -1,
    level = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(#{1,6})\s*\**\s*resultado\b[^\n]*$/i.exec(lines[i]);
    if (m) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const m = /^(#{1,6})\s+\S/.exec(lines[i]);
      if (m && m[1].length <= level) {
        end = i;
        break;
      }
    }
    const body = lines
      .slice(start + 1, end)
      .join('\n')
      .trim();
    if (body) return clip(body, max, 'start');
  }
  return clip(t.trim(), max, 'end');
}
function clip(s, max, keep) {
  if (s.length <= max) return s;
  return keep === 'end' ? '…' + s.slice(s.length - (max - 1)) : s.slice(0, max - 1) + '…';
}

// Handoff block: summarized results of the steps this one depends on.
function handoff(quest, st) {
  const parts = [];
  for (const id of st.dependsOn) {
    const d = step(quest, id);
    if (!d) continue;
    parts.push(
      '### ' +
        d.title +
        ' (' +
        d.provider +
        ')\n' +
        (d.status === 'skipped' ? '(etapa pulada)' : d.result || '(sem resultado)')
    );
  }
  return parts.join('\n\n');
}
// The message that starts a step's chat.
function buildStepPrompt(quest, st) {
  const ho = handoff(quest, st);
  return [
    'Você faz parte de uma quest do VeSTA, em que várias IAs trabalham juntas num objetivo.',
    '## Objetivo da quest: ' + quest.title + '\n' + quest.goal,
    quest.guidelines ? '## Diretrizes\n' + quest.guidelines : '',
    ho ? '## Resultados das etapas anteriores (handoff)\n' + ho : '',
    '## Sua etapa: ' + st.title + (st.kind === 'review' ? ' (revisão)' : '') + '\n' + st.instructions,
    'Faça somente esta etapa. Ao terminar, encerre com uma seção `## Resultado` curta (até ~10 linhas): o que foi feito, arquivos tocados e o que a próxima etapa precisa saber.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

module.exports = { parsePlan, buildPlanPrompt, buildStepPrompt, handoff, extractResult, clip };
