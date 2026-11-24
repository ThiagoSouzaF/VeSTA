// The pieces the screens that run something on their own share (Consolidar, Refino automático): which AI does it
// (and its model) and when it runs (shared/agents.cjs schedules). Every change goes up at once.
import { useEffect, useState } from 'react';
import { PROVIDERS } from '../lib/constants';
import { modelLabel } from '../lib/format';
import { DAY, INTERVALS, describeSchedule } from '../lib/agents';
import { ProviderIcon } from './ProviderIcon';

const ORDER = ['claude', 'codex', 'opencode', 'drael'];
const KINDS = [
  ['manual', 'Só quando eu mandar'],
  ['interval', 'A cada X horas'],
  ['daily', 'Todo dia'],
  ['weekdays', 'Dias úteis'],
  ['weekly', 'Dias da semana'],
];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

// provider/model: the current choice; onChange({ provider } | { model }). keepCurrent: the chosen AI stays clickable
// even when it is not installed (a saved choice).
export function AiPicker({
  label,
  provider,
  model,
  integrations = {},
  onChange,
  keepCurrent = true,
  className = '',
  modelClassName,
}) {
  const models = integrations[provider]?.models || [];
  return (
    <>
      <div className={'consolidation-ais ' + className} role="radiogroup" aria-label={label}>
        {ORDER.map((id) => {
          const installed = !!integrations[id]?.installed;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={provider === id}
              data-ai={id}
              disabled={!installed && !(keepCurrent && provider === id)}
              title={installed ? undefined : 'Não instalada (tela Conexões)'}
              onClick={() => provider !== id && onChange({ provider: id })}
            >
              <ProviderIcon id={id} small />
              <span>{PROVIDERS[id].name}</span>
            </button>
          );
        })}
      </div>
      {models.length > 0 && (
        <select
          className={modelClassName}
          aria-label="Modelo"
          value={model}
          onChange={(e) => onChange({ model: e.target.value })}
        >
          <option value="">Modelo padrão da IA</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {modelLabel(m)}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

// schedule: { kind, time, days, hours }; onChange(patch) with only what changed.
export function ScheduleFields({ label, schedule, onChange, defaultTime = '03:00' }) {
  const [time, setTime] = useState(schedule.time || defaultTime);
  useEffect(() => setTime(schedule.time || defaultTime), [schedule.time, defaultTime]);
  return (
    <>
      <div className="consolidation-when">
        <select
          aria-label={label}
          value={schedule.kind}
          onChange={(e) => onChange({ kind: e.target.value, days: schedule.days?.length ? schedule.days : [1] })}
        >
          {KINDS.map(([id, text]) => (
            <option key={id} value={id}>
              {text}
            </option>
          ))}
        </select>
        {schedule.kind === 'interval' && (
          <select
            aria-label="Intervalo"
            value={schedule.hours}
            onChange={(e) => onChange({ hours: Number(e.target.value) })}
          >
            {INTERVALS.map((h) => (
              <option key={h} value={h}>
                {h === 1 ? '1 hora' : h + ' horas'}
              </option>
            ))}
          </select>
        )}
        {['daily', 'weekdays', 'weekly'].includes(schedule.kind) && (
          <label className="agent-inline">
            às
            <input
              type="time"
              aria-label="Hora"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              onBlur={() => time && time !== schedule.time && onChange({ time })}
            />
          </label>
        )}
      </div>
      {schedule.kind === 'weekly' && (
        <div className="agent-days" role="group" aria-label="Dias da semana">
          {WEEK.map((d) => {
            const on = schedule.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                disabled={on && schedule.days.length === 1}
                onClick={() =>
                  onChange({ days: on ? schedule.days.filter((x) => x !== d) : [...schedule.days, d].sort() })
                }
              >
                {DAY[d]}
              </button>
            );
          })}
        </div>
      )}
      <span className="consolidation-note">
        {describeSchedule(schedule)}. Só roda com o VeSTA aberto; uma hora perdida roda ao abrir.
      </span>
    </>
  );
}
