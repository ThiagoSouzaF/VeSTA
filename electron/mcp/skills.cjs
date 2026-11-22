// "vesta-skills": the MCP server that hands VeSTA's skills to every AI (Claude, Codex, OpenCode, Drael). The chat only
// knows the short catalog; the full text of a skill is read when it is needed (vesta_skill_load), and its supporting
// files one at a time (vesta_skill_file). One token per chat (host.cjs); offered only while some skill is on.
const { createMcpHost } = require('./host.cjs');

const NAME = 'vesta-skills';
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const nameProp = { type: 'string', description: 'Nome da skill (o que vem depois da "/").' };
const TOOLS = [
  ['vesta_skills_list', 'Lista as skills ligadas no VeSTA para esta IA: nome, descrição e quando usar.', obj()],
  [
    'vesta_skill_load',
    'Carrega o texto completo de uma skill do VeSTA (e a lista dos arquivos de apoio). Use quando o pedido combinar com a skill.',
    obj({ name: nameProp }, ['name']),
  ],
  [
    'vesta_skill_file',
    'Lê um arquivo de apoio de uma skill do VeSTA (referências, exemplos). Scripts só rodam se a pessoa permitir.',
    obj({ name: nameProp, path: { type: 'string', description: 'Caminho relativo, como aparece na lista.' } }, [
      'name',
      'path',
    ]),
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
    vesta_skill_file: (chat, a) => {
      const s = allowed(chat, a.name);
      return { name: s.name, path: a.path, text: get().readFile(s.name, a.path) };
    },
  };
  return createMcpHost({ name: NAME, tools: TOOLS, authorize, call: (chat, name, args) => handlers[name](chat, args) });
}

module.exports = { createSkillsMcp, NAME, TOOLS };
