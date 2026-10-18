import { useState, useEffect, useLayoutEffect, useRef } from 'react';

export const NEAR_END = 80;
export const distanceToEnd = (el) => el.scrollHeight - el.scrollTop - el.clientHeight;
export const isNearEnd = (el, threshold = NEAR_END) => distanceToEnd(el) <= threshold;
const editable = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

// Follows the end of the conversation only while the user is near it (80px). Scrolled up, nothing moves and a
// button with the count of new messages / activity appears. Switching chats, or sending, goes to the end.
//   scroller / content: refs for the scrolling container and the block inside it
//   marker: {chatId, messages (non-user count), activity (steps of the last message), sent (user messages count)}
export function useAutoScroll({ chatId, messages, activity, sent }) {
  const scroller = useRef(null),
    content = useRef(null),
    stick = useRef(true),
    smoothing = useRef(false),
    settle = useRef(null),
    prev = useRef({ chatId, messages, activity, sent });
  const [atBottom, setAtBottom] = useState(true),
    [unread, setUnread] = useState(0);
  // A smooth scroll in progress counts as "at the end" until it settles (no scroll event for 150ms): content that
  // grows meanwhile must not make the view give up following.
  const endSmooth = () => {
    clearTimeout(settle.current);
    smoothing.current = false;
    const el = scroller.current;
    if (!el) return;
    const near = isNearEnd(el);
    stick.current = near;
    setAtBottom(near);
    if (near) setUnread(0);
  };
  const goEnd = (smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setUnread(0);
    clearTimeout(settle.current);
    if (smooth) {
      smoothing.current = true;
      settle.current = setTimeout(endSmooth, 150);
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      smoothing.current = false;
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
    }
  };
  const goEndRef = useRef(goEnd);
  goEndRef.current = goEnd;
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = isNearEnd(el);
    if (smoothing.current) {
      clearTimeout(settle.current);
      settle.current = setTimeout(endSmooth, 150);
      if (near) setAtBottom(true);
      return;
    }
    stick.current = near;
    setAtBottom((was) => (was === near ? was : near));
    if (near) setUnread(0);
  };
  // The user takes over a smooth scroll in progress.
  const onWheel = () => {
    if (smoothing.current) endSmooth();
  };
  // Another chat: straight to its end.
  useLayoutEffect(() => {
    goEndRef.current(false);
  }, [chatId]);
  // Anything that makes the content taller (streamed text, images, opened cards) keeps the end in view if the user was there.
  useEffect(() => {
    const el = content.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(settle.current);
    };
  }, []);
  useEffect(() => {
    const p = prev.current;
    prev.current = { chatId, messages, activity, sent };
    if (p.chatId !== chatId) return;
    if (sent > p.sent) return goEndRef.current(false);
    const added = Math.max(0, messages - p.messages) + Math.max(0, activity - p.activity);
    if (added && !stick.current) setUnread((n) => n + added);
  }, [chatId, messages, activity, sent]);
  // End / Ctrl+End jump to the end (End alone only outside text fields, where it moves the caret).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'End' || e.altKey || e.shiftKey) return;
      const t = e.target,
        typing = editable(t) && (!e.ctrlKey || !!t.value);
      if (typing || (!e.ctrlKey && editable(t))) return;
      e.preventDefault();
      goEndRef.current(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { scroller, content, atBottom, unread, onScroll, onWheel, goEnd: () => goEnd(true) };
}
