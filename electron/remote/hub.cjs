// Fan-out of the event bus to the authenticated sockets: batching, ordering and backpressure live here.
const { createCoalescer } = require('./coalesce.cjs');

// Bus events a phone may receive. Everything else ('update', terminal, session...) stays on the desktop.
const STREAM = new Set(['text', 'activity', 'subagent']);
const URGENT = new Set(['permission', 'chat-done']);

// client = { send(string), buffered() -> bytes, deviceId }
function createHub({ bus, getState, differ, flushMs = 50, maxBuffered = 1 << 20, setTimer, clearTimer } = {}) {
  const clients = new Set();
  let unsubscribe = null;
  const RESYNC = JSON.stringify({ t: 'resync' });

  function deliver(text) {
    for (const c of clients) {
      const queued = c.buffered();
      if (c.stale) {
        // Slow socket that lost events: wait until it drains, then tell it to reload the state.
        if (queued > maxBuffered / 4) continue;
        c.stale = false;
        c.send(RESYNC);
      } else if (queued > maxBuffered) {
        c.stale = true;
        continue;
      }
      c.send(text);
    }
  }
  const coalescer = createCoalescer({
    flushMs,
    setTimer,
    clearTimer,
    onFlush: (events) => deliver(JSON.stringify({ t: 'events', events })),
  });
  function onEvent(event) {
    if (!clients.size) return;
    if (STREAM.has(event.type)) coalescer.push(event);
    else if (URGENT.has(event.type)) coalescer.push(event, { urgent: true });
    else if (event.type === 'state')
      coalescer.push({ type: 'state', ...differ.diff(event.state || getState()) }, { urgent: true });
  }
  return {
    start() {
      unsubscribe ||= bus.subscribe(onEvent);
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      coalescer.clear();
      clients.clear();
    },
    add(client) {
      clients.add(client);
    },
    remove(client) {
      clients.delete(client);
    },
    heartbeat() {
      deliver(JSON.stringify({ t: 'hb', at: Date.now() }));
    },
    flush: () => coalescer.flush(),
    get size() {
      return clients.size;
    },
    clientsOf(deviceId) {
      return [...clients].filter((c) => c.deviceId === deviceId);
    },
    all: () => [...clients],
  };
}
module.exports = { createHub, STREAM, URGENT };
