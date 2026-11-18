// DecryptedText, after React Bits (https://reactbits.dev, MIT + Commons Clause, see LICENSE-react-bits.md): the
// text resolves left to right out of scrambled glyphs, once, when it mounts. Ported without the `motion` package
// and reduced to the sequential reveal VeSTA uses on its monospaced chapter labels (equal widths, so nothing
// shifts). Screen readers get the real text while it scrambles; reduced motion shows it as written.
import { useEffect, useState } from 'react';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#_*+-';
const scramble = (text, shown) =>
  [...text]
    .map((ch, i) => (i < shown || /[\s/]/.test(ch) ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
    .join('');

export function DecryptedText({ text, speed = 28, className = '' }) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [out, setOut] = useState(() => (reduced ? text : scramble(text, 0)));
  useEffect(() => {
    if (reduced) return setOut(text);
    let shown = 0;
    const id = setInterval(() => {
      shown += 1;
      setOut(scramble(text, shown));
      if (shown >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, reduced]);
  if (out === text) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{out}</span>
    </span>
  );
}
