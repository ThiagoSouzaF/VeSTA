import { useState, useRef, useEffect } from 'react';
import { ProviderIcon } from './ProviderIcon';
import { PROVIDERS } from '../lib/constants';
import { ChevronDown, Check } from 'lucide-react';
export function ProviderPicker({ value, integrations, disabled, onPick }) {
  const [open, setOpen] = useState(false),
    ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <span className="model-picker" ref={ref}>
      <button
        className="model-chip"
        type="button"
        aria-label="Trocar IA desta conversa"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ProviderIcon id={value} small />
        {PROVIDERS[value].name}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="model-menu">
          <div className="model-menu-title">IA DESTA CONVERSA</div>
          {Object.entries(PROVIDERS).map(([id, p]) => (
            <button
              type="button"
              key={id}
              disabled={!integrations[id]?.installed}
              className={id === value ? 'selected' : ''}
              onClick={() => {
                setOpen(false);
                if (id !== value) onPick(id);
              }}
            >
              <span>{p.name}</span>
              {id === value && <Check size={12} />}
            </button>
          ))}
          <p>
            A próxima IA receberá o histórico textual em uma nova sessão. Isso pode consumir mais uso da conta
            escolhida. Modelo e permissões lembradas serão redefinidos. Drael nativo passa de Pedir permissão para
            Consultar.
          </p>
        </div>
      )}
    </span>
  );
}
