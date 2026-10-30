import { useEffect, useRef } from 'react';

// Ctrl/Cmd+N new chat, Ctrl/Cmd+K focus the search, Esc closes the modal. The handlers are read through a ref, so the
// window listener is added once and always calls the latest ones.
export function useGlobalShortcuts({ openNew, closeModal }) {
  const latest = useRef({ openNew, closeModal });
  latest.current = { openNew, closeModal };
  useEffect(() => {
    const listener = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        latest.current.openNew();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('search-chats')?.focus();
      }
      if (e.key === 'Escape') latest.current.closeModal();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
