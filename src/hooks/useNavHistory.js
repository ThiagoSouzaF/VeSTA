import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNav, keyOf, move, place, push, saveScroll } from '../lib/nav';

// Navigation history for a UI whose "location" is a few pieces of state (page, chat, quest). Every change of place is
// recorded; back/forward re-apply an entry through `apply` and are never recorded again. `isValid(entry)` lets the
// history skip chats and quests that no longer exist. `scroller()` returns the element whose scroll is remembered.
export function useNavHistory(current, isValid, apply, scroller = () => document.querySelector('.content-page')) {
  const [nav, setNav] = useState(createNav);
  const navRef = useRef(nav),
    validRef = useRef(isValid),
    applyRef = useRef(apply),
    scrollerRef = useRef(scroller),
    arriving = useRef(null),
    last = useRef({ at: 0, dir: 0 }),
    keyRef = useRef(''),
    memo = useRef(null);
  validRef.current = isValid;
  applyRef.current = apply;
  scrollerRef.current = scroller;
  const here = place(current);
  const key = keyOf(here);
  keyRef.current = key;
  const commit = (next) => {
    navRef.current = next;
    setNav(next);
  };
  // Scroll of the page being left is known from its last scroll event (by the time the effect below runs, the DOM
  // already shows the new page).
  useEffect(() => {
    const onScroll = (e) => {
      if (e.target?.classList?.contains?.('content-page'))
        memo.current = { key: keyRef.current, top: e.target.scrollTop };
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);
  useEffect(() => {
    // Arriving through back/forward: already in the history.
    if (arriving.current && keyOf(arriving.current) === key) {
      const entry = arriving.current;
      arriving.current = null;
      restoreScroll(entry, scrollerRef.current);
      return;
    }
    arriving.current = null;
    let base = navRef.current;
    const m = memo.current;
    if (m && base.index >= 0 && keyOf(base.stack[base.index]) === m.key) base = saveScroll(base, m.top);
    commit(push(base, here));
  }, [key]);
  const go = useCallback((dir) => {
    // The mouse button reaches us as a mouse event and as a window command: count it once.
    const t = Date.now();
    if (last.current.dir === dir && t - last.current.at < 250) return false;
    last.current = { at: t, dir };
    const saved = saveScroll(navRef.current, scrollerRef.current()?.scrollTop);
    const r = move(saved, dir, validRef.current);
    if (!r) return false;
    arriving.current = r.entry;
    commit(r.nav);
    applyRef.current(r.entry);
    return true;
  }, []);
  // The buttons light up only when there is a real place to go (entries of deleted chats do not count).
  const back = useMemo(() => !!move(nav, -1, isValid), [nav, isValid]);
  const forward = useMemo(() => !!move(nav, 1, isValid), [nav, isValid]);
  return { canBack: back, canForward: forward, goBack: () => go(-1), goForward: () => go(1), go };
}

// Puts the scroll back once the page has rendered its content.
function restoreScroll(entry, scroller) {
  if (!(entry.scroll > 0)) return;
  let tries = 0;
  const attempt = () => {
    const el = scroller();
    if (el) el.scrollTop = entry.scroll;
    if (++tries < 4 && (!el || Math.abs(el.scrollTop - entry.scroll) > 2)) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
