import { useEffect } from 'react';
import { X } from 'lucide-react';
import { MASCOT, MOOD_LABEL } from '../lib/mascot';

export function Mascot({ mood = 'idle', size = 40, label = false }) {
  return (
    <span className={'mascot ' + mood} title={MOOD_LABEL[mood]}>
      <img src={MASCOT[mood]} width={size} height={size} alt={label ? MOOD_LABEL[mood] : ''} decoding="async" />
    </span>
  );
}

// Bottom sheet. Closes with the backdrop, the X or Escape.
export function Sheet({ title, onClose, children, urgent = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={'sheet-root' + (urgent ? ' urgent' : '')}>
      <div className="sheet-backdrop" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Fechar">
              <X size={20} />
            </button>
          )}
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

export const Badge = ({ tone = '', children }) => <span className={'badge ' + tone}>{children}</span>;
export const Empty = ({ title, children }) => (
  <div className="empty">
    <strong>{title}</strong>
    <p>{children}</p>
  </div>
);
