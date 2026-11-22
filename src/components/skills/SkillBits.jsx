// Small pieces shared by the Skills screens: the AI badges, the cost bars, the on/off switch and the health check.
import { ShieldAlert, TriangleAlert, Lightbulb, Check } from 'lucide-react';
import { AIS, aiState, costLevel, fmt } from '../../lib/skills';

export function AiBadges({ skill }) {
  return (
    <span className="skill-ais" aria-label="IAs">
      {AIS.map(([id, letter, name]) => {
        const st = aiState(skill, id);
        return (
          <span
            key={id}
            className={'skill-ai' + (st.ok ? '' : ' off')}
            title={name + ': ' + (st.ok ? 'funciona' : st.why)}
          >
            {letter}
          </span>
        );
      })}
    </span>
  );
}

export function CostBars({ skill }) {
  const level = costLevel(skill);
  return (
    <span className="skill-cost" title={'~' + fmt(skill.tokens) + ' tokens quando usada'}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= level ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Switch({ on, label, onChange, disabled }) {
  return (
    <button
      type="button"
      className="skill-switch"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    />
  );
}

export function ModeSeg({ value, onChange, disabled }) {
  return (
    <span className="skill-seg" role="group" aria-label="Quando usar">
      {[
        ['auto', 'A IA decide'],
        ['slash', 'Só com /'],
      ].map(([id, label]) => (
        <button key={id} type="button" aria-pressed={value === id} disabled={disabled} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </span>
  );
}

// What electron/skills/health.cjs found: a tag with the worst level on a list row, the findings in full below.
const LEVELS = {
  risk: ['RISCO', ShieldAlert],
  warn: ['ATENÇÃO', TriangleAlert],
  tip: ['DICA', Lightbulb],
};
export function HealthTag({ health = [] }) {
  const risks = health.filter((h) => h.level === 'risk').length;
  const warns = health.filter((h) => h.level === 'warn').length;
  if (risks) return <span className="skill-tag risk">{risks + (risks > 1 ? ' riscos' : ' risco')}</span>;
  if (warns) return <span className="skill-tag warn">{warns + (warns > 1 ? ' avisos' : ' aviso')}</span>;
  return null;
}
export function HealthList({ health = [], title, clean }) {
  if (!health.length)
    return clean ? (
      <p className="skill-health-ok">
        <Check size={14} />
        {clean}
      </p>
    ) : null;
  return (
    <div className="skill-health" aria-label={title || 'Verificação da skill'}>
      {title && <h4>{title}</h4>}
      <ul>
        {health.map((h, i) => {
          const [label, Icon] = LEVELS[h.level] || LEVELS.tip;
          return (
            <li key={h.id + i} className={h.level} data-health={h.id}>
              <Icon size={14} />
              <b>{label}</b>
              <span>
                {h.text}
                {h.where && h.where !== 'SKILL.md' && <span className="mono"> {h.where}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
