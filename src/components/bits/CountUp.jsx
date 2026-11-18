// CountUp, after React Bits (https://reactbits.dev, MIT + Commons Clause, see LICENSE-react-bits.md): a number
// counts to its value the first time it is drawn, then follows changes in place. Ported without the `motion`
// package: one requestAnimationFrame loop on the transitions.dev smooth-out curve. Reduced motion shows the value.
import { useEffect, useRef, useState } from 'react';

const easeOut = (t) => 1 - Math.pow(1 - t, 4);

export function CountUp({ to, duration = 900, format = (n) => String(Math.round(n)) }) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [value, setValue] = useState(reduced ? to : 0);
  const from = useRef(reduced ? to : 0);
  useEffect(() => {
    if (reduced || !Number.isFinite(to)) return setValue(to);
    const start = performance.now(),
      a = from.current;
    let raf = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const v = a + (to - a) * easeOut(t);
      from.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [to, duration, reduced]);
  return format(value);
}
