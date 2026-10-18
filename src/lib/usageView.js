// Which AIs report plan windows (and where the reading comes from); the others only count tokens and cost.
export const USAGE_PROVIDERS = {
  order: ['codex', 'claude', 'drael', 'opencode'],
  codex: { windows: 'Lido do Codex ao abrir esta aba e a cada resposta.' },
  claude: { windows: 'Só atualiza depois que você envia uma mensagem pelo Claude.' },
  drael: { windows: null },
  opencode: { windows: null },
};
// Percent filled (0..100) of a window, or 0 once its reset time has passed (the reading is stale then).
export function windowPercent(w, now) {
  if (!w || w.utilization == null) return null;
  if (w.resetsAt && w.resetsAt <= now) return 0;
  return Math.round(Math.min(1, Math.max(0, w.utilization)) * 100);
}
