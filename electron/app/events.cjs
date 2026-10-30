// Event bus with many destinations: the window is one subscriber, a remote server can be another.
function createBus() {
  const subscribers = new Set();
  return {
    emit(event) {
      for (const fn of [...subscribers])
        try {
          fn(event);
        } catch {}
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
module.exports = { createBus };
