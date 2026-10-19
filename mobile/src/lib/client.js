// Talks to the VeSTA desktop: HTTP for commands, one WebSocket for the live stream.
const TOKEN_KEY = 'vesta.remote.token',
  DEVICE_KEY = 'vesta.remote.device';
export const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};
export const saved = () => ({ token: store.get(TOKEN_KEY), device: store.get(DEVICE_KEY) });
export const forget = () => {
  store.del(TOKEN_KEY);
  store.del(DEVICE_KEY);
};
export class AuthError extends Error {}
// The desktop expires devices that stay unused for 30 days (or 180 days after pairing): they must pair again.
export const EXPIRED_MESSAGE = 'Este aparelho expirou por falta de uso. Pareie de novo no desktop.';

async function request(path, body, token) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const msg = data.error || 'Erro ' + res.status;
    throw res.status === 401 && token
      ? Object.assign(new AuthError(msg), { code: data.code })
      : Object.assign(new Error(msg), { status: res.status });
  }
  return data;
}
// Trades the one-time pairing code for this device's token (kept only in this browser's storage).
export async function pair(code, name) {
  const r = await request('/api/pair', { code, name });
  store.set(TOKEN_KEY, r.token);
  store.set(DEVICE_KEY, r.device.name);
  return r;
}
export const makeCall = (token) => async (method, args) => (await request('/api/call', { method, args }, token)).result;

// Sends one file (raw bytes) to be staged on the desktop; resolves with the attachment descriptor.
export const makeUpload = (token) => async (file) => {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      Authorization: 'Bearer ' + token,
      'X-Vesta-Name': encodeURIComponent(file.name || 'arquivo'),
    },
    body: file,
    cache: 'no-store',
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const msg = data.error || 'Erro ' + res.status;
    throw res.status === 401 ? Object.assign(new AuthError(msg), { code: data.code }) : new Error(msg);
  }
  return data.result;
};

const wsUrl = () => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
const STALE_MS = 45_000; // the server sends a heartbeat every 20 s
// Keeps a socket open with exponential backoff. The token travels in the first message, never in the URL.
// Handlers: onReady, onMessage(msg), onStatus(bool online), onAuthFail.
export function connectSocket(token, { onReady, onMessage, onStatus, onAuthFail }) {
  let ws = null,
    retry = 0,
    timer = null,
    watchdog = null,
    closed = false;
  const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => ws?.close(), STALE_MS);
  };
  function open() {
    clearTimeout(timer);
    if (closed) return;
    const mine = (ws = new WebSocket(wsUrl()));
    mine.onopen = () => {
      mine.send(JSON.stringify({ t: 'auth', token }));
      arm();
    };
    mine.onmessage = (ev) => {
      arm();
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'ready') {
        retry = 0;
        onStatus(true);
        onReady();
      } else if (msg.t !== 'hb') onMessage(msg);
    };
    mine.onclose = (ev) => {
      clearTimeout(watchdog);
      if (mine !== ws) return;
      onStatus(false);
      if (closed) return;
      if (ev.code === 4410) return onAuthFail(EXPIRED_MESSAGE);
      if (ev.code === 4401 || ev.code === 4403) return onAuthFail();
      timer = setTimeout(open, Math.min(15000, 500 * 2 ** retry++) + Math.random() * 300);
    };
    mine.onerror = () => {};
  }
  open();
  return {
    reconnectNow() {
      if (ws && ws.readyState === WebSocket.OPEN) return;
      retry = 0;
      const old = ws;
      ws = null;
      try {
        old?.close();
      } catch {}
      open();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      ws?.close();
    },
  };
}
