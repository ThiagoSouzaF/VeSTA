// Navigation history of the desktop UI (pure: the hook in hooks/useNavHistory.js only holds the state).
// An entry is where the person was: { page, active (chat id, chat page only), questSel (quest id, quests page only) }
// plus the scroll position it was left at. The history is a stack with a cursor, like a browser's.
export const LIMIT = 50;

// Only the fields that make up a place: other pages do not remember a chat or a quest.
export const place = ({ page, active, questSel }) => ({
  page: page || 'chat',
  active: page === 'chat' ? active || null : null,
  questSel: page === 'quests' ? questSel || null : null,
});
export const keyOf = (e) => e.page + '|' + (e.active || '') + '|' + (e.questSel || '');
export const createNav = () => ({ stack: [], index: -1 });
export const canBack = (nav) => nav.index > 0;
export const canForward = (nav) => nav.index >= 0 && nav.index < nav.stack.length - 1;

// Visiting somewhere new: drops what was "forward", ignores a repeat of the current place, keeps at most `limit`.
export function push(nav, entry, limit = LIMIT) {
  const e = place(entry);
  if (nav.index >= 0 && keyOf(nav.stack[nav.index]) === keyOf(e)) return nav;
  const stack = [...nav.stack.slice(0, nav.index + 1), e].slice(-limit);
  return { stack, index: stack.length - 1 };
}
// Remembers how far the current place was scrolled (restored when coming back to it).
export function saveScroll(nav, scroll) {
  if (nav.index < 0 || !(scroll >= 0) || nav.stack[nav.index].scroll === scroll) return nav;
  const stack = nav.stack.slice();
  stack[nav.index] = { ...stack[nav.index], scroll };
  return { ...nav, stack };
}
// Moves `dir` (-1 back, +1 forward) to the nearest entry that is still valid, dropping the ones that are not (a chat or
// quest that was deleted) and any entry equal to the place we are leaving. null when there is nowhere to go.
export function move(nav, dir, isValid = () => true) {
  if (nav.index < 0) return null;
  const here = keyOf(nav.stack[nav.index]);
  let stack = nav.stack.slice(),
    i = nav.index;
  for (let n = i + dir; n >= 0 && n < stack.length; n += dir) {
    const e = stack[n];
    if (keyOf(e) !== here && isValid(e)) {
      // Entries skipped on the way are forgotten.
      const lo = Math.min(n, i) + 1,
        hi = Math.max(n, i) - 1;
      stack.splice(lo, hi - lo + 1);
      const target = stack.indexOf(e);
      return { nav: { stack, index: target }, entry: e };
    }
  }
  return null;
}
