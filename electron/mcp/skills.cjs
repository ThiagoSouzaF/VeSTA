// "vesta-skills": the MCP server that hands VeSTA's skills to every AI (Claude, Codex, OpenCode, Drael). The chat only
// knows the short catalog; the full text of a skill is read when it is needed (vesta_skill_load), and its supporting
// files one at a time (vesta_skill_file). vesta_skill_find reads any skill by name, also those an AI has on its own. One token per chat (host.cjs); offered only while some skill is on.
const { createMcpHost } = require('./host.cjs');

const NAME = 'vesta-skills';
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const nameProp = { type: 'string', description: 'Nome da skill (o que vem depois da "/").' };
// Every tool only reads: marked so, they also work in Só consulta (Claude Code blocks other MCP tools in plan mode).
const READ = { readOnlyHint: true };
const TOOLS = [
  ['vesta_skills_list', 'Lista as skills ligadas no VeSTA para esta IA: nome, descrição e quando usar.', obj(), READ],
  [
    'vesta_skill_load',
    'Carrega o texto completo de uma skill do VeSTA (e a lista dos arquivos de apoio). Use quando o pedido combinar com a skill.',
    obj({ name: nameProp }, ['name']),
    READ,
  ],
  [
    'vesta_skill_find',
    'Procura uma skill pelo nome na biblioteca do VeSTA e nas IAs instaladas (Claude Code, Codex) e devolve o SKILL.md inteiro, de onde vem e os arquivos de apoio. Use para explicar ou comparar uma skill.',
    obj(
      {
        name: { type: 'string', description: 'Nome (ou parte do nome) da skill.' },
        ia: { type: 'string', enum: ['vesta', 'claude', 'codex'], description: 'Opcional: onde procurar.' },
      },
      ['name']
    ),
    READ,
  ],
  [
    'vesta_skill_file',
    'Lê um arquivo de apoio de uma skill do VeSTA (referências, exemplos). Scripts só rodam se a pessoa permitir.',
    obj({ name: nameProp, path: { type: 'string', description: 'Caminho relativo, como aparece na lista.' } }, [
      'name',
      'path',
    ]),
    READ,
  ],
];

function createSkillsMcp(ctx, { skills }) {
  const get = typeof skills === 'function' ? skills : () => skills;
  const authorize = (chatId) => {
    const chat = ctx.store.state.chats.find((c) => c.id === chatId);
    if (!chat || chat.skillDraft || chat.skills === false || !get()?.hasAny()) return null;
    return chat;
  };
  const allowed = (chat, name) => {
    const s = get()
      .usable(chat)
      .find((x) => x.name === String(name || ''));
    if (!s) throw Object.assign(new Error('Skill não disponível para esta IA: ' + name), { userSafe: true });
    return s;
  };
  const handlers = {
    vesta_skills_list: (chat) =>
      get()
        .usable(chat)
        .map((s) => ({
          name: s.name,
          description: s.description,
          quando: s.mode === 'slash' ? 'só com /' + s.name : 'a IA decide',
        })),
    vesta_skill_load: (chat, a) => {
      const s = allowed(chat, a.name);
      const r = get().read(s.name);
      get().used(s.name);
      return { name: s.name, text: r.text, files: r.files.map((f) => f.path) };
    },
    vesta_skill_find: (chat, a) => {
      const found = get().find(String(a.name || '').slice(0, 120), a.ia);
      return found.length
        ? found
        : { encontrado: false, dica: 'Nenhuma skill com esse nome. Confira o nome na tela Skills.' };
    },
    vesta_skill_file: (chat, a) => {
      const s = allowed(chat, a.name);
      return { name: s.name, path: a.path, text: get().readFile(s.name, a.path) };
    },
  };
  return createMcpHost({ name: NAME, tools: TOOLS, authorize, call: (chat, name, args) => handlers[name](chat, args) });
}

module.exports = { createSkillsMcp, NAME, TOOLS };
