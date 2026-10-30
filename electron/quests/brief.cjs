// The quest's own chat sees the whole quest on every message: this builds that brief.
const { progress, STATUS_PT } = require('../shared/quests.cjs');
const { clip } = require('./plan.cjs');

// Context of the quest's own chat, rebuilt for every message the person sends there: the AI sees the whole quest and
// a clip of every step's conversation, so it can walk the person through them. `chatOf(id)` -> chat or undefined.
const QUEST_PT = {
  draft: 'rascunho',
  running: 'rodando',
  paused: 'pausada',
  done: 'concluída',
  failed: 'falhou',
  cancelled: 'cancelada',
};
// What the quest chat is told about its tools (the `vesta-quest` MCP server; scoped to this quest only).
const LEAD_TOOLS = [
  '## Suas ferramentas (servidor MCP "vesta-quest", só desta quest)',
  '- quest_get: estado completo (etapas, IA/modelo/modo, dependências, resultados, diário).',
  '- chat_read(stepId | chatId, desde?, deslocamento?, limite?): histórico COMPLETO do chat de uma etapa, em páginas, com comandos, subagentes e atividades resumidos. Use quando a pessoa perguntar o que uma etapa respondeu; o trecho em cada etapa abaixo é só um resumo cortado.',
  '- chat_send(stepId, mensagem): envia uma mensagem ao chat de uma etapa (falha se ele estiver respondendo).',
  '- activity_get: tarefas em andamento nos chats da quest (comandos, subagentes, segundo plano). task_stop(chatId, taskId) encerra uma delas; chat_stop(stepId) interrompe a resposta de uma etapa.',
  '- step_update(stepId, provider?, model?, mode?, title?, instructions?, dependsOn?), step_add(...), step_remove(stepId): editam o plano; só etapas pendentes ou com problema podem ser alteradas, e só pendentes removidas. step_retry(stepId), step_skip(stepId).',
  '- quest_start, quest_pause, quest_resume: controlam a quest.',
  'Você pode reorganizar a quest (trocar a IA de uma etapa, ajustar instruções, adicionar, remover, tentar de novo ou pular etapas) quando a pessoa pedir; sem pedido, só sugira. Depois de agir, confirme o que mudou com quest_get e diga em uma frase.',
].join('\n');
function buildLeadBrief(q, chatOf = () => undefined, { perStep = 1500, max = 24000, tools = true } = {}) {
  const p = progress(q);
  const steps = q.steps.map((s) => {
    const chat = s.chatId ? chatOf(s.chatId) : null;
    const last = chat ? [...chat.messages].reverse().find((m) => m.role === 'assistant' && (m.text || m.error)) : null;
    const reply = last ? clip(String(last.text || last.error).trim(), perStep, 'end') : '';
    return [
      '### ' + s.id + ' · ' + s.title + (s.kind === 'review' ? ' (revisão)' : ''),
      'IA: ' +
        s.provider +
        (s.model ? ' (' + s.model + ')' : '') +
        ' · ' +
        STATUS_PT[s.status] +
        (s.attempts > 1 ? ' · ' + s.attempts + ' tentativas' : '') +
        (s.dependsOn.length ? ' · depende de ' + s.dependsOn.join(', ') : '') +
        (chat ? ' · chat "' + chat.title + '"' : ''),
      s.result ? 'Resultado: ' + s.result : '',
      reply && reply !== s.result ? 'Última resposta no chat da etapa (trecho):\n' + reply : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  const out = [
    'Este é o chat da quest "' +
      q.title +
      '" no VeSTA. Você acompanha a quest para a pessoa: explica o andamento, resume e compara as conversas das etapas, aponta problemas e sugere o que fazer (tentar de novo, pular, ajustar o plano). As etapas rodam em chats próprios; não refaça o trabalho delas aqui a menos que a pessoa peça. Você não edita arquivos do projeto.',
    tools
      ? LEAD_TOOLS
      : '(As ferramentas da quest estão indisponíveis nesta mensagem: oriente a pessoa a usar o quadro.)',
    '## Objetivo\n' + q.goal,
    q.guidelines ? '## Diretrizes\n' + q.guidelines : '',
    '## Situação: ' +
      QUEST_PT[q.status] +
      ' · ' +
      p.done +
      '/' +
      p.total +
      ' etapas' +
      (p.running ? ' · ' + p.running + ' rodando' : '') +
      (p.errors ? ' · ' + p.errors + ' com problema' : ''),
    steps.length ? '## Etapas\n' + steps.join('\n\n') : '## Etapas\nAinda não há plano.',
    q.summary ? '## Resumo final\n' + q.summary : '',
    q.log.length
      ? '## Diário (mais recentes)\n' +
        q.log
          .slice(-10)
          .map((e) => '- ' + e.text)
          .join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return clip(out, max, 'start');
}

module.exports = { buildLeadBrief };
