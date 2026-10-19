import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { MAX_COUNT } from '../lib/attachments';
const KEY = 'vesta.attachments';
const load = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
// Attachments chosen but not sent yet, per chat ('new' is the welcome screen). The files already sit in the staging
// folder of the main process; only their descriptors are kept here (and in localStorage, like the text drafts).
export function usePendingAttachments({ chats, loading }) {
  const [pending, setPending] = useState(load);
  const addPending = useCallback(
    (key, items) => setPending((p) => ({ ...p, [key]: [...(p[key] || []), ...items].slice(0, MAX_COUNT) })),
    []
  );
  const removePending = useCallback((key, id) => {
    api?.call('discardAttachment', { id }).catch(() => {});
    setPending((p) => {
      const list = (p[key] || []).filter((a) => a.id !== id);
      const { [key]: _, ...rest } = p;
      return list.length ? { ...p, [key]: list } : rest;
    });
  }, []);
  // After a send the files belong to the message: forget them without deleting.
  const clearPending = useCallback(
    (...keys) =>
      setPending((p) => {
        if (!keys.some((k) => k in p)) return p;
        const next = { ...p };
        for (const k of keys) delete next[k];
        return next;
      }),
    []
  );
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      try {
        const ids = new Set(chats.map((c) => c.id)),
          keep = {};
        for (const [k, v] of Object.entries(pending)) if (v?.length && (k === 'new' || ids.has(k) || !api)) keep[k] = v;
        localStorage.setItem(KEY, JSON.stringify(keep));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [pending, chats, loading]);
  return { pending, addPending, removePending, clearPending };
}
