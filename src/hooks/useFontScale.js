import { useState, useEffect, useRef } from 'react';
import { clampScale, stepScale, zoomKey, zoomWheel } from '../lib/zoom';

const apply = (scale) => document.documentElement.style.setProperty('--font-scale', String(scale));

// Text zoom of the conversation. The CSS variable changes at once; the value is saved shortly after the last
// change. Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 and Ctrl+wheel drive it (the native Electron zoom is disabled).
export function useFontScale(saved, save) {
  const [scale, setScaleState] = useState(() => clampScale(saved));
  const current = useRef(scale),
    timer = useRef(null),
    lastWheel = useRef(0),
    saveRef = useRef(save);
  saveRef.current = save;
  const setScale = (next) => {
    next = clampScale(next);
    if (next === current.current) return;
    current.current = next;
    apply(next);
    setScaleState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(next), 250);
  };
  const setScaleRef = useRef(setScale);
  setScaleRef.current = setScale;
  // The saved value arrives with the state (first load, or another window).
  useEffect(() => {
    const s = clampScale(saved);
    if (s === current.current) return;
    current.current = s;
    apply(s);
    setScaleState(s);
  }, [saved]);
  useEffect(() => {
    apply(current.current);
    const onKey = (e) => {
      const dir = zoomKey(e);
      if (dir == null) return;
      e.preventDefault();
      setScaleRef.current(stepScale(current.current, dir));
    };
    const onWheel = (e) => {
      const dir = zoomWheel(e);
      if (dir == null) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheel.current < 80) return;
      lastWheel.current = now;
      setScaleRef.current(stepScale(current.current, dir));
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, true);
      clearTimeout(timer.current);
    };
  }, []);
  return [scale, (dir) => setScale(stepScale(current.current, dir))];
}
