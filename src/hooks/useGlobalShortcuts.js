import { useEffect, useRef } from 'react';

// Ctrl/Cmd+N new chat, Ctrl/Cmd+K focus the search (opening Conversas), Ctrl/Cmd+B opens or closes Conversas, Esc closes
// the modal. The handlers are read through a ref, so the
// window listener is added once and always calls the latest ones.
export function useGlobalShortcuts({ openNew, closeModal, toggleDrawer }) {
  const latest = useRef({ openNew, closeModal, toggleDrawer });
  latest.current = { openNew, closeModal, toggleDrawer };
  useEffect(() => {
    const listener = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        latest.current.openNew();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        latest.current.toggleDrawer?.(true);
        setTimeout(() => document.getElementById('search-chats')?.focus(), 0);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        latest.current.toggleDrawer?.();
      }
      if (e.key === 'Escape') latest.current.closeModal();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
