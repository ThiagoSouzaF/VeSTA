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

// The sidebar's folders: the Espaço pessoal (chats without a project) first, then every project in the order they
// were added, each with its chats in the list's order. Projects without chats still get a folder (to start one).
export const PERSONAL = 'personal';
export function groupChats(chats, projects) {
  const byProject = new Map(projects.map((p) => [p.id, []]));
  const personal = [];
  for (const c of chats) (byProject.get(c.projectId) || personal).push(c);
  return [
    { key: PERSONAL, name: 'Espaço pessoal', project: null, chats: personal },
    ...projects.map((p) => ({ key: p.id, name: p.name, project: p, chats: byProject.get(p.id) })),
  ];
}
