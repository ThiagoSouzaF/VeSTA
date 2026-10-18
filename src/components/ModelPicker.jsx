import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Sparkles } from 'lucide-react';
import { modelLabel } from '../lib/format';
import { MODEL_LABELS } from '../lib/constants';
export function ModelPicker({ value, models, disabled, onPick }) {
  const [open, setOpen] = useState(false),
    [custom, setCustom] = useState(''),
    ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pick = (m) => {
    setOpen(false);
    setCustom('');
    if (m !== value) onPick(m);
  };
  const list = ['', ...(models || [])];
  if (value && !list.includes(value)) list.push(value);
  return (
    <span className="model-picker" ref={ref}>
      <button
        type="button"
        className="model-chip"
        disabled={disabled}
        title={disabled ? 'Aguarde a resposta terminar' : 'Trocar modelo'}
        onClick={() => setOpen((o) => !o)}
      >
        <Sparkles size={12} />
        {modelLabel(value)}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="model-menu">
          <div className="model-menu-title">MODELO DESTE CHAT</div>
          {list.map((m) => (
            <button
              type="button"
              key={m || 'default'}
              className={m === value ? 'selected' : ''}
              onClick={() => pick(m)}
            >
              <span>{modelLabel(m)}</span>
              {m && MODEL_LABELS[m] && <code>{m}</code>}
              {m === value && <Check size={12} />}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) pick(custom.trim());
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Outro modelo (id)…"
              aria-label="Outro modelo"
            />
          </form>
          <p>A troca vale a partir da próxima mensagem; a conversa continua.</p>
        </div>
      )}
    </span>
  );
}
