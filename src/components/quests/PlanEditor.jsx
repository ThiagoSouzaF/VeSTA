import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Play, Save } from 'lucide-react';
import { ProviderIcon } from '../ProviderIcon';
import { PROVIDERS } from '../../lib/constants';
import { MAX_STEPS, earlier, normalizeStep, removeStep, reorder, validateSteps } from '../../lib/quests';

const MODES = [
  ['edit', 'Acesso completo'],
  ['read', 'Consulta'],
  ['ask', 'Pedir permissão'],
];

// Plan editor (draft quests): add, edit, reorder and remove steps; pick AI, model, mode and dependencies.
export function PlanEditor({ quest, integrations, onSave, onStart, busy }) {
  const [steps, setSteps] = useState(quest.steps);
  const [dirty, setDirty] = useState(false);
  const ais = Object.keys(PROVIDERS).filter((id) => integrations[id]?.installed);
  const change = (next) => {
    setSteps(next);
    setDirty(true);
  };
  const patch = (id, fields) => change(steps.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  const add = () =>
    change([
      ...steps,
      normalizeStep(
        {
          id: 'n' + Date.now().toString(36),
          title: 'Etapa ' + (steps.length + 1),
          provider: ais[0] || 'claude',
          dependsOn: steps.length ? [steps[steps.length - 1].id] : [],
        },
        steps.length
      ),
    ]);
  const problem = steps.length ? validateSteps(steps) : null;
  return (
    <section className="plan-editor" aria-label="Plano da quest">
      <ol>
        {steps.map((s, i) => (
          <li className="plan-step" key={s.id} data-step={s.id}>
            <div className="plan-step-head">
              <span className="plan-step-num">{i + 1}</span>
              <ProviderIcon id={s.provider} small />
              <input
                aria-label={'Título da etapa ' + (i + 1)}
                value={s.title}
                onChange={(e) => patch(s.id, { title: e.target.value })}
              />
              <button
                className="icon-button"
                aria-label="Subir etapa"
                title="Subir"
                disabled={i === 0}
                onClick={() => change(reorder(steps, i, i - 1))}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="icon-button"
                aria-label="Descer etapa"
                title="Descer"
                disabled={i === steps.length - 1}
                onClick={() => change(reorder(steps, i, i + 1))}
              >
                <ArrowDown size={14} />
              </button>
              <button
                className="icon-button"
                aria-label="Remover etapa"
                title="Remover"
                onClick={() => change(removeStep(steps, s.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <textarea
              aria-label={'Instruções da etapa ' + (i + 1)}
              value={s.instructions}
              placeholder="O que esta IA deve fazer (ela não vê o resto da conversa; os resultados das etapas anteriores chegam sozinhos)."
              onChange={(e) => patch(s.id, { instructions: e.target.value })}
            />
            <div className="plan-step-opts">
              <label>
                IA
                <select
                  aria-label={'IA da etapa ' + (i + 1)}
                  value={s.provider}
                  onChange={(e) =>
                    patch(s.id, {
                      provider: e.target.value,
                      model: '',
                      mode: e.target.value === 'drael' && s.mode === 'ask' ? 'read' : s.mode,
                    })
                  }
                >
                  {Object.entries(PROVIDERS).map(([id, p]) => (
                    <option key={id} value={id} disabled={!integrations[id]?.installed}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Modelo
                <input
                  aria-label={'Modelo da etapa ' + (i + 1)}
                  list={'models-' + s.provider}
                  value={s.model}
                  placeholder="Padrão da conta"
                  disabled={s.provider === 'drael'}
                  onChange={(e) => patch(s.id, { model: e.target.value })}
                />
              </label>
              <label>
                Modo
                <select
                  aria-label={'Modo da etapa ' + (i + 1)}
                  value={s.mode}
                  onChange={(e) => patch(s.id, { mode: e.target.value })}
                >
                  {MODES.filter(([id]) => !(s.provider === 'drael' && id === 'ask')).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo
                <select
                  aria-label={'Tipo da etapa ' + (i + 1)}
                  value={s.kind}
                  onChange={(e) => patch(s.id, { kind: e.target.value })}
                >
                  <option value="work">Trabalho</option>
                  <option value="review">Revisão</option>
                </select>
              </label>
            </div>
            {i > 0 && (
              <div className="plan-deps" role="group" aria-label={'Dependências da etapa ' + (i + 1)}>
                <span>Depende de</span>
                {earlier(steps, i).map((id) => {
                  const j = steps.findIndex((x) => x.id === id),
                    on = s.dependsOn.includes(id);
                  return (
                    <button
                      key={id}
                      className={'dep-chip' + (on ? ' on' : '')}
                      aria-pressed={on}
                      title={steps[j].title}
                      onClick={() =>
                        patch(s.id, { dependsOn: on ? s.dependsOn.filter((d) => d !== id) : [...s.dependsOn, id] })
                      }
                    >
                      {j + 1}. {steps[j].title.slice(0, 22)}
                    </button>
                  );
                })}
                {!s.dependsOn.length && <em>nenhuma: roda já, em paralelo</em>}
              </div>
            )}
          </li>
        ))}
      </ol>
      {Object.keys(PROVIDERS).map((id) => (
        <datalist id={'models-' + id} key={id}>
          {(integrations[id]?.models || []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      ))}
      {!steps.length && <p className="plan-empty">Nenhuma etapa ainda. Adicione a primeira ou planeje com uma IA.</p>}
      {problem && steps.length > 0 && <p className="plan-problem">{problem}</p>}
      <div className="plan-actions">
        <button className="secondary-button" onClick={add} disabled={steps.length >= MAX_STEPS}>
          <Plus size={14} />
          Adicionar etapa
        </button>
        <span className="grow" />
        <button
          className="secondary-button"
          disabled={!dirty || !!problem || busy}
          onClick={() => onSave(steps).then(() => setDirty(false))}
        >
          <Save size={14} />
          Salvar plano
        </button>
        <button
          className="primary-button"
          data-action="start"
          disabled={!steps.length || !!problem || busy}
          onClick={() => onStart(steps)}
        >
          <Play size={14} />
          Iniciar quest
        </button>
      </div>
    </section>
  );
}
