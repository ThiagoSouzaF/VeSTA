import { useState, useEffect } from 'react';
// One interval per period shared by every subscriber: dozens of running timers cost a single setInterval.
const tickers = new Map();
function subscribe(every, fn) {
  let t = tickers.get(every);
  if (!t) {
    t = { subs: new Set(), timer: null };
    t.timer = setInterval(() => {
      const now = Date.now();
      for (const f of t.subs) f(now);
    }, every);
    tickers.set(every, t);
  }
  t.subs.add(fn);
  return () => {
    t.subs.delete(fn);
    if (!t.subs.size) {
      clearInterval(t.timer);
      tickers.delete(every);
    }
  };
}
export function useNow(active, every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    return subscribe(every, setNow);
  }, [active, every]);
  return now;
}
