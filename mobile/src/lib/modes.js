// Chat modes as shown on the phone (same ids and wording as the desktop; no icons needed here).
export const MODES = {
  ask: { label: 'Pedir permissão', hint: 'A IA pede sua aprovação antes de editar arquivos ou rodar comandos.' },
  edit: { label: 'Acesso completo', hint: 'A IA edita arquivos e roda comandos sem perguntar.' },
  read: { label: 'Consulta', hint: 'Só ler, analisar e planejar.' },
};
export const modeLabel = (m) => (MODES[m] || MODES.edit).label;
