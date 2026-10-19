import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { makeCall, makeUpload, connectSocket, AuthError } from '../lib/client';
import { emptyState, reduceEvents, pendingPermissions } from '../lib/state';
import { createEventBuffer } from '../../../src/lib/streamBuffer';
import { notifyPermission } from '../lib/notify';

const initial = { state: emptyState, done: {}, integrations: {}, loaded: false };
// Everything the signed-in app needs: state, live connection and `call`. Stream events are applied once per frame.
export function useRemote(token, onAuthFail) {
  const [data, setData] = useState(initial);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(initial);
  const commit = (next) => {
    latest.current = next;
    setData(next);
  };
  const buffer = useRef(null);
  if (!buffer.current)
    buffer.current = createEventBuffer((batch) => {
      const r = reduceEvents(latest.current, batch);
      if (r.state !== latest.current.state || r.done !== latest.current.done)
        commit({ ...latest.current, state: r.state, done: r.done });
    });
  const call = useMemo(() => {
    const raw = makeCall(token);
    return async (method, args) => {
      try {
        return await raw(method, args);
      } catch (e) {
        if (e instanceof AuthError) onAuthFail(e.code === 'expired' ? e.message : undefined);
        throw e;
      }
    };
  }, [token]);
  const upload = useMemo(() => {
    const raw = makeUpload(token);
    return async (file) => {
      try {
        return await raw(file);
      } catch (e) {
        if (e instanceof AuthError) onAuthFail(e.code === 'expired' ? e.message : undefined);
        throw e;
      }
    };
  }, [token]);
  const bootstrap = useCallback(async () => {
    try {
      const r = await call('bootstrap');
      buffer.current.discard();
      commit({ ...latest.current, state: r.state, integrations: r.integrations, loaded: true });
      setError('');
    } catch (e) {
      if (!(e instanceof AuthError)) setError(e.message);
    }
  }, [call]);

  useEffect(() => {
    const conn = connectSocket(token, {
      onReady: bootstrap,
      onStatus: setOnline,
      onAuthFail,
      onMessage: (msg) => {
        if (msg.t === 'resync') return bootstrap();
        if (msg.t !== 'events') return;
        for (const e of msg.events) {
          if (e.type !== 'state' && e.type !== 'chat-done') {
            buffer.current.push(e);
            continue;
          }
          // Order matters: queued deltas first, then the snapshot (which already contains them).
          buffer.current.flush();
          const r = reduceEvents(latest.current, [e]);
          if (r.missing) bootstrap();
          else commit({ ...latest.current, state: r.state, done: r.done });
        }
      },
    });
    const wake = () => !document.hidden && conn.reconnectNow();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      conn.close();
    };
  }, [token]);

  // Permission requests that appear while the app is in the background raise a local notification.
  const notified = useRef(new Set());
  useEffect(() => {
    if (!data.loaded) return;
    for (const { chat, permission } of pendingPermissions(data.state.chats))
      if (!notified.current.has(permission.id)) {
        notified.current.add(permission.id);
        if (document.hidden) notifyPermission(permission, chat.title);
      }
  }, [data.state.chats, data.loaded]);
  return { ...data, online, error, call, upload, reload: bootstrap };
}
