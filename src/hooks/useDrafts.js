import { useState, useEffect } from 'react';
import { api } from '../lib/api';
const loadDrafts = () => {
  try {
    const v = JSON.parse(localStorage.getItem('vesta.drafts') || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
// Unsent text per chat ('new' is the welcome screen), kept in localStorage between launches.
export function useDrafts({ chats, loading }) {
  const [drafts, setDrafts] = useState(loadDrafts);
  const setDraft = (k, v) =>
    setDrafts((d) => {
      if (!v) {
        if (!(k in d)) return d;
        const { [k]: _, ...rest } = d;
        return rest;
      }
      return { ...d, [k]: v };
    });
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      try {
        const ids = new Set(chats.map((c) => c.id)),
          keep = {};
        for (const [k, v] of Object.entries(drafts)) if (v && (k === 'new' || ids.has(k) || !api)) keep[k] = v;
        localStorage.setItem('vesta.drafts', JSON.stringify(keep));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [drafts, chats, loading]);
  return { drafts, setDraft };
}
