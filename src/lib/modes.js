import { Pencil, ShieldCheck, ShieldQuestion } from 'lucide-react';
// How each chat may work: ask before acting, full access, or consultation only.
export const MODES = {
  ask: {
    label: 'Pedir permissão',
    icon: ShieldQuestion,
    hint: 'A IA pede sua aprovação antes de editar arquivos ou rodar comandos.',
    foot: 'Pedir permissão · você aprova cada comando ou edição, inclusive dos subagentes',
  },
  edit: {
    label: 'Acesso completo',
    icon: Pencil,
    hint: 'A IA edita arquivos e roda comandos sem perguntar.',
    foot: 'Acesso completo · a IA pode editar arquivos e rodar comandos',
  },
  read: {
    label: 'Consulta',
    icon: ShieldCheck,
    hint: 'Só ler, analisar e planejar.',
    foot: 'Modo consulta · sem edição de arquivos',
  },
};
export const modeOf = (m) => (MODES[m] ? m : 'edit');
