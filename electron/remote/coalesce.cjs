// Groups the stream into batches: consecutive text deltas of one message are joined and everything is flushed on a
// timer (~50 ms). "Urgent" events (permission requests, state, end of turn) flush the queue first, keeping order.
function createCoalescer({ onFlush, flushMs = 50, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let queue = [],
    timer = null;
  const flush = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    onFlush(batch);
  };
  return {
    push(event, { urgent = false } = {}) {
      const last = queue[queue.length - 1];
      if (
        event.type === 'text' &&
        last?.type === 'text' &&
        last.chatId === event.chatId &&
        last.messageId === event.messageId
      )
        last.text += event.text;
      else queue.push(event.type === 'text' ? { ...event } : event);
      if (urgent) flush();
      else if (timer == null) {
        timer = setTimer(flush, flushMs);
        timer.unref?.();
      }
    },
    flush,
    clear() {
      if (timer != null) clearTimer(timer);
      timer = null;
      queue = [];
    },
    get size() {
      return queue.length;
    },
  };
}
module.exports = { createCoalescer };
