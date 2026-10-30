import { useEffect } from 'react';

// Alt+Left / Alt+Right and the back / forward buttons of the mouse walk the navigation history.
export function useNavShortcuts(navGo) {
  useEffect(() => {
    const keys = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        navGo(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    const mouse = (e) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type === 'mouseup') navGo(e.button === 3 ? -1 : 1);
    };
    window.addEventListener('keydown', keys);
    for (const t of ['mousedown', 'mouseup', 'auxclick']) window.addEventListener(t, mouse);
    return () => {
      window.removeEventListener('keydown', keys);
      for (const t of ['mousedown', 'mouseup', 'auxclick']) window.removeEventListener(t, mouse);
    };
  }, [navGo]);
}
