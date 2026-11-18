import { useEffect, useRef, useState } from 'react';

// Keeps the last non-empty `value` on screen for `exitMs` after it goes away, so the surface can play its exit
// (motion.css reads data-state="closing"). Returns [shown, state]: shown is what to render, null when gone.
export function usePresence(value, exitMs) {
  const [shown, setShown] = useState(value);
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (value) {
      setShown(value);
      setClosing(false);
      return undefined;
    }
    if (!shown) return undefined;
    setClosing(true);
    timer.current = setTimeout(() => {
      setShown(null);
      setClosing(false);
    }, exitMs);
    return () => clearTimeout(timer.current);
  }, [value, exitMs]);
  return [value || shown, closing ? 'closing' : 'open'];
}

// Exit times, in step with the tokens in motion.css.
export const EXIT = { modal: 150, toast: 350, panel: 350 };
