import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { action } from '../lib/api';

// Copies `text`; the icon turns into a check for a moment (transitions.dev icon swap) and `onCopied` runs.
export function CopyButton({ text, label, onCopied }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const id = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(id);
  }, [done]);
  const Icon = done ? Check : Copy;
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={action(async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        onCopied?.();
      })}
    >
      <span key={String(done)} className="t-icon-swap">
        <Icon size={17} />
      </span>
    </button>
  );
}
