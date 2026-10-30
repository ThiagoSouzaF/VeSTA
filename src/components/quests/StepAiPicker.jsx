import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { MODE_LABEL } from '../../lib/quests';

const MODES = ['edit', 'read', 'ask'];

// Inline editor of a step that has not started (or failed): installed AI -> that AI's models -> mode.
// Applies through `onSave({ provider, model, mode })`; the engine re-validates everything.
export function StepAiPicker({ step, integrations, onSave, onCancel }) {
  const [provider, setProvider] = useState(step.provider),
    [model, setModel] = useState(step.model),
    [mode, setMode] = useState(step.mode),
    [busy, setBusy] = useState(false);
  const ais = Object.keys(PROVIDERS).filter((id) => integrations[id]?.installed || id === step.provider);
  const models = integrations[provider]?.models || [];
  const modelOptions = model && !models.includes(model) ? [model, ...models] : models;
  const changeProvider = (id) => {
    setProvider(id);
    setModel('');
    if (id === 'drael' && mode === 'ask') setMode('read');
  };
  const dirty = provider !== step.provider || model !== step.model || mode !== step.mode;
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ provider, model, mode });
    } catch {
      setBusy(false);
    }
  };
  return (
    <div className="step-picker" data-step-picker={step.id}>
      <label>
        IA
        <select
          aria-label={'IA da etapa ' + step.title}
          value={provider}
          onChange={(e) => changeProvider(e.target.value)}
        >
          {ais.map((id) => (
            <option key={id} value={id}>
              {PROVIDERS[id].name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Modelo
        <select
          aria-label={'Modelo da etapa ' + step.title}
          value={model}
          disabled={provider === 'drael'}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">Padrão da conta</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        Modo
        <select aria-label={'Modo da etapa ' + step.title} value={mode} onChange={(e) => setMode(e.target.value)}>
          {MODES.filter((m) => !(provider === 'drael' && m === 'ask')).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <div className="step-picker-actions">
        <button className="step-link" data-action="save-step-ai" disabled={!dirty || busy} onClick={save}>
          <Check size={12} />
          Aplicar
        </button>
        <button className="step-link muted" data-action="cancel-step-ai" onClick={onCancel}>
          <X size={12} />
          Cancelar
        </button>
      </div>
    </div>
  );
}
