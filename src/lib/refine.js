// Refining skills and agents on the screen: the diff and the version rules live in electron/shared/refine.cjs, shared
// with the main process.
import shared from '../../electron/shared/refine.cjs';

export const { lineDiff, diffStats, diffHunks, MAX_VERSIONS, skillSignals, agentSignals, candidates } = shared;

// The signals of a skill or an agent as a line ('' when there is nothing since the last review).
export function signalsLine(kind, sig) {
  const n = (v, one, many) => (v ? v + ' ' + (v > 1 ? many : one) : '');
  const parts =
    kind === 'skill'
      ? [n(sig.uses, 'uso', 'usos'), n(sig.corrections, 'correção', 'correções'), n(sig.errors, 'erro', 'erros')]
      : [
          n(sig.runs, 'execução', 'execuções'),
          n(sig.errors, 'falha', 'falhas'),
          n(sig.corrections, 'correção', 'correções'),
          n(sig.pending, 'lição esperando', 'lições esperando'),
        ];
  return parts.filter(Boolean).join(', ');
}

// The refinement chat of a skill or an agent, if there is one.
export const refineChatOf = (chats, kind, target) =>
  (chats || []).find(
    (c) =>
      !c.refineRun &&
      c.refine?.kind === kind &&
      (kind === 'skill' ? c.refine.name === target.name : c.refine.id === target.id)
  ) || null;

// What a refinement chat refines -> { kind, target } (target null when it was removed).
export function refineTargetOf(chat, data) {
  const r = chat?.refine;
  if (!r) return null;
  const target =
    r.kind === 'skill'
      ? (data.skills?.list || []).find((s) => s.name === r.name) || null
      : (data.agents || []).find((a) => a.id === r.id) || null;
  return { kind: r.kind, target, label: r.kind === 'skill' ? '/' + r.name : target?.name || 'agent removido' };
}
