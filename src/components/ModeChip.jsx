import { useState } from 'react';
import { MODES, modeOf } from '../lib/modes';
import { ChevronDown, Check } from 'lucide-react';
export function ModeChip({ nativeDrael = false, mode, disabled, onPick }) {
  const [open, setOpen] = useState(false),
    cur = MODES[modeOf(mode)],
    Icon = cur.icon;
  return (
    <span
      className="mode-picker"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className={'mode-chip ' + modeOf(mode)}
        disabled={disabled}
        title="Como a IA pode trabalhar nesta conversa"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon size={11} />
        {cur.label}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="mode-menu" role="menu">
          {Object.entries(MODES)
            .filter(([id]) => !nativeDrael || id !== 'ask')
            .map(([id, m]) => {
              const I = m.icon;
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={id === modeOf(mode)}
                  className={id === modeOf(mode) ? 'chosen' : ''}
                  key={id}
                  onClick={() => {
                    setOpen(false);
                    if (id !== modeOf(mode)) onPick(id);
                  }}
                >
                  <I size={14} />
                  <div>
                    <strong>{m.label}</strong>
                    <span>{m.hint}</span>
                  </div>
                  {id === modeOf(mode) && <Check size={13} />}
                </button>
              );
            })}
        </div>
      )}
    </span>
  );
}
