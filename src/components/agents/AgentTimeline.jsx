// "Hoje": one 24 h lane per agent, with what already ran (filled, struck through when it failed) and what is still
// planned (hollow), and a line for now. A click on a lane opens that agent.
import { STATUS, agoLabel, todayTimeline, whenLabel } from '../../lib/agents';

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

export function AgentTimeline({ agents, now, selected, onSelect }) {
  const { nowPct, rows } = todayTimeline(agents, now);
  const planned = rows.reduce((n, r) => n + r.marks.filter((m) => m.kind === 'planned').length, 0);
  const done = rows.reduce((n, r) => n + r.marks.filter((m) => m.kind !== 'planned').length, 0);
  return (
    <section className="agent-timeline" aria-label="Hoje">
      <header>
        <b>HOJE</b>
        <span>
          {done} execuç{done === 1 ? 'ão' : 'ões'} · {planned} planejada{planned === 1 ? '' : 's'}
        </span>
        <span className="agent-legend" aria-hidden="true">
          <i className="ok" /> rodou <i className="error" /> falhou <i className="planned" /> agendada
        </span>
      </header>
      <div className="agent-lanes">
        <div className="agent-ruler" aria-hidden="true">
          <span />
          <div>
            {HOURS.map((h) => (
              <span key={h} style={{ left: (h / 24) * 100 + '%' }}>
                {String(h).padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>
        {rows.map(({ agent, marks }) => (
          <button
            key={agent.id}
            className={'agent-lane' + (agent.enabled ? '' : ' off') + (agent.id === selected ? ' selected' : '')}
            onClick={() => onSelect(agent.id)}
            data-lane={agent.name}
          >
            <span className="agent-lane-name">{agent.name}</span>
            <span className="agent-track">
              {HOURS.slice(1, -1).map((h) => (
                <i key={h} className="agent-hour" style={{ left: (h / 24) * 100 + '%' }} />
              ))}
              {marks.map((m, i) => (
                <i
                  key={i}
                  className={'agent-mark ' + m.kind}
                  style={{ left: m.pct + '%' }}
                  title={
                    m.kind === 'planned'
                      ? 'Agendada: ' + whenLabel(m.t, now)
                      : STATUS[m.kind === 'running' ? 'running' : m.kind] +
                        ' · ' +
                        agoLabel(m.t, now) +
                        (m.run?.summary ? ' · ' + m.run.summary : '')
                  }
                />
              ))}
              {!marks.length && <small>{agent.enabled ? 'nada hoje' : 'inativo'}</small>}
            </span>
          </button>
        ))}
        <div className="agent-now" style={{ '--now': nowPct + '%' }} aria-hidden="true">
          <span>agora</span>
        </div>
      </div>
    </section>
  );
}
