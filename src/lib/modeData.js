// How each chat may work: ask before acting, full access, or consultation only. Pure wording, shared by the desktop
// (src/lib/modes.js adds the icons) and the phone (mobile/src/lib/modes.js).
export const MODE_DATA = {
  ask: {
    label: 'Pedir permissão',
    hint: 'A IA pede sua aprovação antes de editar arquivos ou rodar comandos.',
    foot: 'Pedir permissão · você aprova cada comando ou edição, inclusive dos subagentes',
  },
  edit: {
    label: 'Acesso completo',
    hint: 'A IA edita arquivos e roda comandos sem perguntar.',
    foot: 'Acesso completo · a IA pode editar arquivos e rodar comandos',
  },
  read: {
    label: 'Consulta',
    hint: 'Só ler, analisar e planejar.',
    foot: 'Modo consulta · sem edição de arquivos',
  },
};
