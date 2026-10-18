import { useState } from 'react';
import { Sparkles, ListPlus, X } from 'lucide-react';
import { IconButton } from '../IconButton';
import { PROVIDERS } from '../../lib/constants';

// "Dar uma quest": title, goal, guidelines and project, then plan with an AI or assemble by hand.
export function NewQuestModal({ projects, integrations, onClose, onCreate }) {
  const ais = Object.keys(PROVIDERS).filter((id) => integrations[id]?.installed);
  const [form, setForm] = useState({
    title: '',
    goal: '',
    guidelines: '',
    projectId: projects[0]?.id || '',
    maxParallel: 2,
    plannerProvider: ais.includes('claude') ? 'claude' : ais[0] || 'claude',
    plannerModel: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (fields) => setForm((f) => ({ ...f, ...fields }));
  const valid = form.title.trim() && form.goal.trim();
  const submit = async (planWithAi) => {
    setBusy(true);
    try {
      await onCreate({
        title: form.title,
        goal: form.goal,
        guidelines: form.guidelines,
        projectId: form.projectId || null,
        maxParallel: Number(form.maxParallel),
        plan: planWithAi ? { provider: form.plannerProvider, model: form.plannerModel } : undefined,
      });
    } catch {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal quest-modal" role="dialog" aria-modal="true" aria-label="Nova quest">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">UMA MISSÃO PARA VÁRIAS IAS</span>
            <h2>Dar uma quest.</h2>
          </div>
          <IconButton icon={X} label="Fechar diálogo" onClick={onClose} />
        </div>
        <label className="field-label" htmlFor="quest-title">
          TÍTULO
        </label>
        <input
          id="quest-title"
          value={form.title}
          maxLength={120}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Ex.: Página de contato com testes"
        />
        <label className="field-label" htmlFor="quest-goal">
          OBJETIVO
        </label>
        <textarea
          id="quest-goal"
          value={form.goal}
          onChange={(e) => set({ goal: e.target.value })}
          placeholder="O que precisa ficar pronto, em linguagem simples."
        />
        <label className="field-label" htmlFor="quest-guidelines">
          DIRETRIZES (opcional)
        </label>
        <textarea
          id="quest-guidelines"
          value={form.guidelines}
          onChange={(e) => set({ guidelines: e.target.value })}
          placeholder="Regras para todas as IAs: estilo, o que não mexer, como testar."
        />
        <div className="row quest-form-row">
          <div>
            <label className="field-label" htmlFor="quest-project">
              PROJETO
            </label>
            <select id="quest-project" value={form.projectId} onChange={(e) => set({ projectId: e.target.value })}>
              <option value="">Espaço pessoal</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="quest-parallel">
              ETAPAS EM PARALELO
            </label>
            <select id="quest-parallel" value={form.maxParallel} onChange={(e) => set({ maxParallel: e.target.value })}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="field-label" htmlFor="quest-planner">
          QUEM PLANEJA?
        </label>
        <div className="row">
          <select
            id="quest-planner"
            value={form.plannerProvider}
            onChange={(e) => set({ plannerProvider: e.target.value, plannerModel: '' })}
          >
            {ais.map((id) => (
              <option key={id} value={id}>
                {PROVIDERS[id].name}
              </option>
            ))}
          </select>
          <input
            aria-label="Modelo do planejador"
            value={form.plannerModel}
            onChange={(e) => set({ plannerModel: e.target.value })}
            placeholder="Modelo (padrão da conta)"
            list="quest-planner-models"
          />
          <datalist id="quest-planner-models">
            {(integrations[form.plannerProvider]?.models || []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <p className="field-help">
          A IA escolhida lê o objetivo e propõe as etapas, quem faz cada uma e a ordem. Você revisa e edita antes de
          iniciar. Ela só planeja: nada é alterado no projeto.
        </p>
        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="secondary-button" disabled={!valid || busy} onClick={() => submit(false)}>
            <ListPlus size={15} />
            Montar manualmente
          </button>
          <button className="primary-button" disabled={!valid || busy || !ais.length} onClick={() => submit(true)}>
            <Sparkles size={15} />
            Planejar com IA
          </button>
        </div>
      </div>
    </div>
  );
}
