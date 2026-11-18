// Small pieces shared by the Skills screens: the AI badges, the cost bars and the on/off switch.
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
