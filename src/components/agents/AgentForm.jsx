// Creating or editing an agent: its name, the AI (and model), where it works, what it does, when it runs and what it
// may touch. The sentence under "Quando" shows the schedule in words and the next time, as the person types.
import { useMemo, useState } from 'react';
import { Brain, BookOpen, History } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { modelLabel } from '../../lib/format';
import { ProviderIcon } from '../ProviderIcon';
import { MODES } from '../../lib/modes';
import { DAY, INTERVALS, describeSchedule, nextRun, whenLabel } from '../../lib/agents';

const KINDS = [
  ['manual', 'Quando eu pedir'],
  ['daily', 'Todo dia'],
  ['weekdays', 'Dias úteis'],
  ['weekly', 'Dias da semana'],
  ['interval', 'A cada X horas'],
];
const ORDER = ['claude', 'codex', 'opencode', 'drael'];
// Monday first, as people read a week.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export const blankAgent = (integrations = {}) => ({
  name: '',
  prompt: '',
  provider: ORDER.find((p) => integrations[p]?.installed) || 'claude',
  model: '',
  projectId: null,
  mode: 'read',
  memory: true,
  skills: true,
  skillNames: [],
  catchUp: true,
  enabled: true,
  schedule: { kind: 'weekdays', time: '08:30', days: [1, 3, 5], hours: 4 },
});

function Toggle({ icon: Icon, label, hint, on, onChange }) {
  return (
    <label className="agent-toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <Icon size={15} />
      <span>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
    </label>
  );
}

const MAX_OWN_SKILLS = 8;

export function AgentForm({
  initial,
  integrations = {},
  projects = [],
  skills = [],
  busy,
  onSave,
  onCancel,
  onRemove,
  isNew,
}) {
  const [f, setF] = useState(() => ({
    ...initial,
    skillNames: initial.skillNames || [],
    schedule: { days: [1, 3, 5], hours: 4, time: '08:30', ...initial.schedule },
  }));
  // The library's enabled skills, plus any chosen one that is now off or gone (shown so it can be taken out).
  const library = skills.filter((s) => s.enabled);
  const missing = f.skillNames.filter((n) => !library.some((s) => s.name === n));
  const pick = (name) =>
    setF((x) => ({
      ...x,
      skillNames: x.skillNames.includes(name)
        ? x.skillNames.filter((n) => n !== name)
        : [...x.skillNames, name].slice(0, MAX_OWN_SKILLS),
    }));
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const sch = (patch) => setF((x) => ({ ...x, schedule: { ...x.schedule, ...patch } }));
  const models = integrations[f.provider]?.models || [];
  const preview = useMemo(() => {
    try {
      const next = nextRun(f.schedule, Date.now());
      return describeSchedule(f.schedule) + (next ? ' · próxima: ' + whenLabel(next) : '');
    } catch (e) {
      return e.message;
    }
  }, [f.schedule]);
  const ready = f.name.trim() && f.prompt.trim() && (f.schedule.kind !== 'weekly' || f.schedule.days.length);
  return (
    <form
      className="agent-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave(f);
      }}
    >
      <div className="agent-field">
        <label htmlFor="agent-name">NOME</label>
        <input
          id="agent-name"
          value={f.name}
          maxLength={60}
          autoFocus={isNew}
          placeholder="Ex.: Bom dia do VeSTA"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="agent-field">
        <span className="agent-label">QUEM FAZ</span>
        <div className="agent-ais" role="radiogroup" aria-label="IA do agent">
          {ORDER.map((id) => {
            const installed = !!integrations[id]?.installed;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={f.provider === id}
                data-ai={id}
                disabled={!installed && f.provider !== id}
                title={installed ? undefined : 'Não instalada (tela Conexões)'}
                onClick={() => set({ provider: id, model: '' })}
              >
                <ProviderIcon id={id} small />
                <span>{PROVIDERS[id].name}</span>
                {!installed && <small>não instalada</small>}
              </button>
            );
          })}
        </div>
        <div className="agent-row">
          {models.length > 0 && (
            <select aria-label="Modelo" value={f.model} onChange={(e) => set({ model: e.target.value })}>
              <option value="">Modelo padrão da IA</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {modelLabel(m)}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Projeto"
            value={f.projectId || ''}
            onChange={(e) => set({ projectId: e.target.value || null })}
          >
            <option value="">Espaço pessoal (sem pasta)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="agent-field">
        <label htmlFor="agent-prompt">O QUE FAZER</label>
        <textarea
          id="agent-prompt"
          value={f.prompt}
          maxLength={8000}
          rows={5}
          placeholder="Escreva como pediria num chat. Pode chamar uma skill com /nome."
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </div>

      <div className="agent-field">
        <span className="agent-label">
          SKILLS DESTE AGENT <small>vão inteiras em toda execução</small>
        </span>
        {library.length || missing.length ? (
          <div className="agent-skill-pick" role="group" aria-label="Skills deste agent">
            {library.map((s) => (
              <button
                key={s.name}
                type="button"
                aria-pressed={f.skillNames.includes(s.name)}
                data-skill={s.name}
                title={s.description}
                disabled={!f.skillNames.includes(s.name) && f.skillNames.length >= MAX_OWN_SKILLS}
                onClick={() => pick(s.name)}
              >
                /{s.name}
                {s.tokens ? <small>~{s.tokens} tokens</small> : null}
              </button>
            ))}
            {missing.map((n) => (
              <button key={n} type="button" aria-pressed="true" className="gone" onClick={() => pick(n)}>
                /{n}
                <small>fora da biblioteca</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="agent-note">Nenhuma skill ligada na biblioteca (tela Skills).</p>
        )}
      </div>

      <div className="agent-field">
        <span className="agent-label">QUANDO</span>
        <div className="agent-seg" role="radiogroup" aria-label="Quando rodar">
          {KINDS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={f.schedule.kind === id}
              data-kind={id}
              onClick={() => sch({ kind: id })}
            >
              {label}
            </button>
          ))}
        </div>
        {f.schedule.kind === 'weekly' && (
          <div className="agent-days" role="group" aria-label="Dias da semana">
            {WEEK.map((d) => {
              const on = f.schedule.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    sch({ days: on ? f.schedule.days.filter((x) => x !== d) : [...f.schedule.days, d].sort() })
                  }
                >
                  {DAY[d]}
                </button>
              );
            })}
          </div>
        )}
        <div className="agent-row">
          {['daily', 'weekdays', 'weekly'].includes(f.schedule.kind) && (
            <label className="agent-inline">
              às
              <input
                type="time"
                aria-label="Hora"
                value={f.schedule.time}
                onChange={(e) => e.target.value && sch({ time: e.target.value })}
              />
            </label>
          )}
          {f.schedule.kind === 'interval' && (
            <label className="agent-inline">
              a cada
              <select
                aria-label="Intervalo"
                value={f.schedule.hours}
                onChange={(e) => sch({ hours: Number(e.target.value) })}
              >
                {INTERVALS.map((h) => (
                  <option key={h} value={h}>
                    {h === 1 ? '1 hora' : h + ' horas'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="agent-preview" aria-live="polite">
            {preview}
          </span>
        </div>
      </div>

      <div className="agent-field">
        <span className="agent-label">PODE</span>
        <div className="agent-modes" role="radiogroup" aria-label="O que o agent pode fazer">
          {['read', 'ask', 'edit'].map((id) => {
            const M = MODES[id];
            const Icon = M.icon;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={f.mode === id}
                data-mode={id}
                onClick={() => set({ mode: id })}
              >
                <Icon size={15} />
                <b>{M.label}</b>
                <small>
                  {id === 'ask'
                    ? 'Cada comando ou edição espera você aprovar; o agent aparece como "esperando você".'
                    : M.hint}
                </small>
              </button>
            );
          })}
        </div>
        <p className="agent-note">
          Em qualquer modo, o agent é instruído a não publicar nada fora do computador (push, comentários, mensagens):
          ele prepara e descreve para você aprovar.
        </p>
      </div>

      <div className="agent-toggles">
        <Toggle
          icon={Brain}
          label="Memória"
          hint="Recebe e grava na memória do projeto, como um chat."
          on={f.memory}
          onChange={(memory) => set({ memory })}
        />
        <Toggle
          icon={BookOpen}
          label="Outras skills"
          hint="Além das deste agent, pode carregar as skills ligadas do VeSTA quando combinarem."
          on={f.skills}
          onChange={(skills) => set({ skills })}
        />
        <Toggle
          icon={History}
          label="Recuperar horário perdido"
          hint="Se o VeSTA estava fechado na hora, roda uma vez ao abrir."
          on={f.catchUp}
          onChange={(catchUp) => set({ catchUp })}
        />
      </div>

      <div className="agent-form-foot">
        {onRemove && (
          <button type="button" className="danger-button left" onClick={onRemove}>
            Apagar agent
          </button>
        )}
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="primary-button" disabled={!ready || busy}>
          {isNew ? 'Criar agent' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
