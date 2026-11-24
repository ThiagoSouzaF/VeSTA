// Refining skills and agents on the screen: the diff and the version rules live in electron/shared/refine.cjs, shared
// with the main process.
import shared from '../../electron/shared/refine.cjs';

export const { lineDiff, diffStats, diffHunks, MAX_VERSIONS } = shared;

// The refinement chat of a skill or an agent, if there is one.
export const refineChatOf = (chats, kind, target) =>
  (chats || []).find(
    (c) => c.refine?.kind === kind && (kind === 'skill' ? c.refine.name === target.name : c.refine.id === target.id)
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
