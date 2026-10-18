import { Mark, Wordmark } from './Brand';
import { api } from '../lib/api';
import { Minus, Square, X } from 'lucide-react';
export function Titlebar() {
  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <Mark size={19} />
        <Wordmark />
      </div>
      <span className="titlebar-caption">Mantenha a chama acesa</span>
      <div className="window-controls">
        <button aria-label="Minimizar" onClick={() => api?.call('window', { action: 'minimize' })}>
          <Minus size={15} />
        </button>
        <button aria-label="Maximizar" onClick={() => api?.call('window', { action: 'maximize' })}>
          <Square size={12} />
        </button>
        <button aria-label="Fechar" onClick={() => api?.call('window', { action: 'close' })}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
