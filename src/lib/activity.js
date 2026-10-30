import tasks from '../../electron/shared/tasks.cjs';

// Pure selector behind the Activity screen, the sidebar counters and the per-message summary.
// Everything is memoized by object identity: the stream buffer keeps the identity of chats and messages that did
// not change, so a text delta only recomputes the one message it touched.
const { messageTasks, buildTree, countTasks } = tasks;

export const RECENT_MS = 30 * 60 * 1000;
const TURNS_PER_CHAT = 6;

const messageCache = new WeakMap(); // message -> { live, value }
// Tasks of one assistant message: { tasks, root (tree), counts, startedAt, endedAt, running }
export function messageActivity(chat, m, live = false) {
  const hit = messageCache.get(m);
  if (hit && hit.live === live) return hit.value;
  const list = messageTasks(chat, m, { live });
  const counts = countTasks(list),
    turn = list[0];
  const value = {
    messageId: m.id,
    tasks: list,
    root: buildTree(list)[0],
    counts,
    status: turn.status,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    // Newest moment anything happened on this turn: drives "recent" and the ordering of groups.
    lastAt: list.reduce((x, t) => Math.max(x, t.endedAt || t.startedAt || 0), 0),
  };
  messageCache.set(m, { live, value });
  return value;
}
export const hasWork = (m) =>
  m.role === 'assistant' && (m.status === 'running' || !!m.activities?.length || !!m.subagents?.length);

const groupCache = new WeakMap(); // chat -> { live, group }
// One chat -> its latest turns with work, or null when it has none. `live` = a turn is running for this chat.
export function chatGroup(chat, live = false, following = false) {
  const hit = groupCache.get(chat);
  if (hit && hit.live === live && hit.following === following) return hit.group;
  const turns = [];
  for (let i = chat.messages.length - 1; i >= 0 && turns.length < TURNS_PER_CHAT; i--) {
    const m = chat.messages[i];
    if (hasWork(m)) turns.push(messageActivity(chat, m, live && i === chat.messages.length - 1));
  }
  let group = null;
  if (turns.length) {
    const counts = { total: 0, running: 0, subagents: 0, commands: 0, background: 0, tools: 0, detached: 0 };
    for (const t of turns) for (const k of Object.keys(counts)) counts[k] += t.counts[k];
    group = {
      chatId: chat.id,
      title: chat.title,
      provider: chat.provider,
      projectId: chat.projectId || null,
      live,
      following, // Claude is waiting for this chat's background processes (see follow.cjs)
      turns, // newest first
      counts,
      lastAt: Math.max(...turns.map((t) => t.lastAt)),
    };
  }
  groupCache.set(chat, { live, following, group });
  return group;
}

// All chats -> groups with something to show (newest activity first, live ones on top).
export function activityGroups(chats, runningIds = [], followingIds = []) {
  const live = new Set(runningIds),
    followed = new Set(followingIds),
    groups = [];
  for (const c of chats) {
    const g = chatGroup(c, live.has(c.id), followed.has(c.id));
    if (g) groups.push(g);
  }
  return groups.sort((a, b) => b.live - a.live || b.lastAt - a.lastAt);
}
// Running tasks per chat (for the sidebar) and in total.
export function runningCounts(groups) {
  const byChat = {};
  let total = 0;
  for (const g of groups)
    if (g.counts.running) {
      byChat[g.chatId] = g.counts.running;
      total += g.counts.running;
    }
  return { byChat, total };
}
// Header numbers: AIs working now and what is running (detached background commands are reported apart).
export function summarize(groups) {
  const s = { working: 0, subagents: 0, commands: 0, background: 0, tools: 0, detached: 0, running: 0 };
  for (const g of groups) {
    if (g.live) s.working++;
    s.detached += g.counts.detached;
    for (const t of g.turns)
      for (const k of t.tasks) {
        if (k.kind === 'turn' || k.status !== 'running' || tasks.isDetached(k)) continue;
        s.running++;
        if (k.kind === 'subagent') s.subagents++;
        else if (k.kind === 'command') s.commands++;
        else if (k.kind === 'background' || k.kind === 'monitor') s.background++;
        else s.tools++;
      }
  }
  return s;
}
// Applies the screen's filters. `scope` 'running' keeps live groups and groups with running tasks; 'all' keeps the
// last RECENT_MS. `provider` 'all' or one AI id.
export function filterGroups(groups, { scope = 'running', provider = 'all', now = Date.now() } = {}) {
  return groups.filter(
    (g) =>
      (provider === 'all' || g.provider === provider) &&
      (scope === 'running'
        ? g.live || g.following || g.counts.running > 0
        : g.live || g.following || g.counts.running > 0 || g.lastAt >= now - RECENT_MS)
  );
}
// Can the user end this task? Only Claude tasks the CLI is still tracking, while its process is alive.
export const canStopTask = (task, live) =>
  !!live && task.status === 'running' && !!task.taskId && task.provider === 'claude' && !tasks.isDetached(task);
