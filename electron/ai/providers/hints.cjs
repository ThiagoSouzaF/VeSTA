// The instruction that tells an agent which AI Memory scope is its own.
const { MEMORY_SERVER } = require('./mcp-servers.cjs');

// Tells the agent which scope is its own: tool calls without workspace/project would land in the server's default (inbox).
// `mode`: 'read' (consultation) never asks to write; edit/ask also teach durable preferences ("profile"). Subagents often
// have a fixed tool list without the memory tools, so the agent itself consults before delegating.
const PROFILE_CATEGORIES = ['stack', 'architecture', 'workflow', 'testing', 'tools', 'style', 'habits'];
function memoryHint(projectId, { mode = 'edit', handoff = false } = {}) {
  const project = projectId || 'inbox';
  const lines = [
    'Você tem acesso à memória compartilhada do VeSTA pelas ferramentas MCP do servidor "' +
      MEMORY_SERVER +
      '" (AI Memory). Nelas, passe workspace "vesta" e project "' +
      project +
      '" (exceto nas gravações com scope "profile", que valem para todos os projetos e não levam workspace/project).',
    'O perfil do usuário e o resumo do projeto já vêm junto desta mensagem, quando existem: use memory_query só quando precisar de algo específico que não esteja ali. Antes de delegar a um subagente, consulte a memória você mesmo e repasse no prompt dele o contexto relevante: subagentes com lista de ferramentas própria podem não ter acesso à memória. Se o subagente tiver acesso, mande-o usar workspace "vesta" e project "' +
      project +
      '".',
  ];
  if (handoff)
    lines.push(
      'Esta conversa veio de outra IA: se houver uma passagem de contexto pendente que você não viu, use memory_handoff_accept (workspace "vesta", project "' +
        project +
        '").'
    );
  if (mode === 'read')
    lines.push(
      'Modo consulta: apenas consulte a memória. Não grave nada, nem preferências; se algo merecer registro, diga ao usuário.'
    );
  else
    lines.push(
      'Use memory_write_page para registrar decisões, fatos e lições duráveis deste projeto (caminhos como "agentes/<assunto>.md"); tags e entities são listas (arrays), por exemplo tags: ["decisao"], entities: ["VeSTA"]. Não grave segredos nem trechos longos de código.',
      'Quando o usuário expressar uma preferência durável (como gosta de trabalhar, stack, estilo, ferramentas, idioma), grave-a no perfil: memory_write_page com scope "profile" e path "<categoria>/<assunto>.md" (categorias: ' +
        PROFILE_CATEGORIES.join(', ') +
        '; sem o prefixo profile/), uma preferência por página, o corpo começando com "# Título" e a frase da preferência na linha seguinte. Antes, consulte (memory_query) se o assunto já existe: se existir, atualize a mesma página (expected_page_id da leitura) em vez de duplicar; para uma nova, use create_only true. Só preferências que o usuário disse de fato, nunca suposições. O perfil vale para todos os projetos: decisões, regras e fatos de um projeto (banco, engine, cursos, deploy, um jogo) vão no projeto, nunca no perfil.'
    );
  return lines.join(' ');
}
module.exports = { memoryHint, PROFILE_CATEGORIES };
