import { useLayoutEffect, useRef } from 'react';

// Sliding tabs (transitions.dev): one indicator travels to the active option of a tab row. Render
// <span className="tab-ink" ref={ink} /> inside the row (the row gets .tab-ink-host); `active` is a CSS selector
// for the chosen option, `key` anything that changes when it does. The first paint and resizes jump without
// animating, so the ink never slides in from the left edge; only a change of option travels.
export function useTabInk(active, key) {
  const ink = useRef(null);
  const selector = useRef(active);
  selector.current = active;

  const place = (instant) => {
    const el = ink.current,
      tab = el?.parentElement?.querySelector(selector.current);
    if (!el) return;
    if (!tab) return void (el.style.opacity = '0');
    if (instant) el.setAttribute('data-instant', '');
    el.style.opacity = '1';
    el.style.setProperty('--ink-x', tab.offsetLeft + 'px');
    el.style.setProperty('--ink-w', tab.offsetWidth + 'px');
    if (instant) {
      void el.offsetWidth;
      el.removeAttribute('data-instant');
    }
  };

  // Mount: place at once, then follow the row's size without animating.
  useLayoutEffect(() => {
    const row = ink.current?.parentElement;
    if (!row) return undefined;
    place(true);
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) return void (first = false);
      place(true);
    });
    ro.observe(row);
    return () => ro.disconnect();
  }, []);

  // A new option: the ink travels there.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (mounted.current) place(false);
    mounted.current = true;
  }, [active, key]);
  return ink;
}
