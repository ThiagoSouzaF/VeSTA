import { useEffect } from 'react';
import { X } from 'lucide-react';
import { createContext, useContext } from 'react';
import { MASCOT } from '../../../src/lib/mascotImages';
import { STATE_LABEL } from '../../../src/lib/mascot';

// Global mascot state (App provides it): { enabled, state, phrase }.
export const MascotCtx = createContext({ enabled: false, state: 'idle', phrase: '' });

// Panel of a state. `face` crops the top of the panel (the face) for small round avatars.
export function Mascot({ mood = 'idle', size = 40, label = false, face = false }) {
  return (
    <span
      className={'mascot ' + mood + (face ? ' face' : '')}
      style={face ? { width: size, height: size } : undefined}
      title={STATE_LABEL[mood]}
    >
      <img
        src={MASCOT[mood]}
        {...(face ? {} : { width: size, height: size })}
        alt={label ? STATE_LABEL[mood] : ''}
        decoding="async"
      />
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
// Empty screen. With the mascot on, Vesta (calm panel) invites the action.
export function Empty({ title, children, mascot = false }) {
  const m = useContext(MascotCtx);
  return (
    <div className="empty">
      {mascot && m.enabled && (
        <div className="empty-mascot">
          <Mascot mood={m.state === 'sleeping' ? 'sleeping' : 'idle'} size={92} />
        </div>
      )}
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
