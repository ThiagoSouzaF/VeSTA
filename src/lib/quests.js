import quests from '../../electron/quests.cjs';

// Pure quest model shared with the main process (scheduler, plan validation, progress, board columns).
export const { progress, columns, validateSteps, normalizeStep, MAX_STEPS } = quests;

export const QUEST_STATUS = {
  draft: 'Rascunho',
  running: 'Rodando',
  paused: 'Pausada',
  done: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};
export const STEP_STATUS = {
  pending: 'Pendente',
  running: 'Rodando',
  done: 'Concluída',
  error: 'Problema',
  skipped: 'Pulada',
};
export const BOARD_COLUMNS = [
  ['pending', 'Pendentes'],
  ['running', 'Rodando'],
  ['done', 'Concluídas'],
  ['problems', 'Problemas'],
];
export const MODE_LABEL = { edit: 'Edita', read: 'Consulta', ask: 'Pede permissão' };
export const runningQuests = (list) => list.filter((q) => q.status === 'running').length;
export const clock = (t) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(t);
// Ids of the steps that come before position `i`: the only ones a step may depend on.
export const earlier = (steps, i) => steps.slice(0, i).map((s) => s.id);
// Moves a step and drops dependencies that no longer point backwards.
export function reorder(steps, from, to) {
  if (to < 0 || to >= steps.length || from === to) return steps;
  const next = steps.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next.map((s, i) => ({ ...s, dependsOn: s.dependsOn.filter((d) => earlier(next, i).includes(d)) }));
}
export const removeStep = (steps, id) =>
  steps.filter((s) => s.id !== id).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== id) }));
