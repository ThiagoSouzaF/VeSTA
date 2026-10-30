// Lists shown in the sidebar and in Memória: what the search box, the project picker and the memory tabs leave visible.

// Chats started by a quest live in the quest (its board and its own chat), not in Conversas. A deleted quest's chats
// come back to the list, so nothing becomes unreachable.
export function filterChats(chats, quests, { projectId, search }) {
  const questIds = new Set(quests.map((q) => q.id));
  const needle = search.toLowerCase();
  return chats.filter(
    (c) =>
      !(c.questId && questIds.has(c.questId)) &&
      (!projectId || c.projectId === projectId) &&
      c.title.toLowerCase().includes(needle)
  );
}

// Preferences follow the project filter everywhere; "notes" is whatever is not a session, preference or insight.
export function filterMemories(memories, { filter, projectId, search }) {
  const needle = search.toLowerCase();
  return memories.filter(
    (m) =>
      (filter === 'all' ||
        (filter === 'preferences' && m.kind === 'preference') ||
        (filter === 'insights' && m.kind === 'insight') ||
        (filter === 'notes' && m.kind !== 'session' && m.kind !== 'preference' && m.kind !== 'insight') ||
        (filter === 'sessions' && m.kind === 'session')) &&
      (!projectId || m.projectId === projectId || m.kind === 'preference') &&
      (m.title + ' ' + m.body).toLowerCase().includes(needle)
  );
}
