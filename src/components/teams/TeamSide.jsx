// Beside the desk: the team's conversations (newest first, only one agent's when a card is selected) and its board.
import { useState } from 'react';
import { COLUMNS, COLUMN_LABELS, HUMAN, KIND_LABELS, hhmm, nameOf } from '../../lib/teams';
import { ProviderIcon } from '../ProviderIcon';

export function TeamSide({ team, focus, onFocus }) {
  const [tab, setTab] = useState('log');
  const msgs = [...(team.messages || [])].reverse();
  const tasks = team.tasks || [];
  const open = tasks.filter((t) => t.column !== 'done').length;
  const mine = (m) => !focus || m.from === focus || m.to === focus;
  return (
    <aside className="team-side" aria-label="Conversas e quadro da equipe">
      <div className="team-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'log'} data-tab="log" onClick={() => setTab('log')}>
          Conversas <span className="n">{msgs.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'board'} data-tab="board" onClick={() => setTab('board')}>
          Quadro <span className="n">{open}</span>
        </button>
      </div>
      {tab === 'log' ? (
        <div className="team-pane">
          {focus && (
            <div className="team-filter">
              Só as conversas de <b>{nameOf(team, focus)}</b> ·{' '}
              <button onClick={() => onFocus(null)}>mostrar todas</button>
            </div>
          )}
          <div className="team-log" aria-live="polite">
            {msgs.length === 0 && <p className="team-empty">Nada ainda. As conversas da equipe aparecem aqui.</p>}
            {msgs.map((m) => (
              <div
                key={m.id}
                className={'team-entry' + (m.kind === 'note' ? ' sys' : '') + (mine(m) ? '' : ' dim')}
                data-kind={m.kind}
              >
                <time>{hhmm(m.at)}</time>
                <div>
                  <span className="route">
                    {m.kind === 'note' ? (
                      <b>{m.from === HUMAN ? 'Você' : m.from ? nameOf(team, m.from) : 'VeSTA'}</b>
                    ) : (
                      <>
                        <b>{nameOf(team, m.from)}</b> → <b>{nameOf(team, m.to)}</b>
                        <span className="kind">{KIND_LABELS[m.kind]}</span>
                      </>
                    )}
                  </span>
                  <div className="txt">
                    {m.held && <span className="team-held">na fila: lugar fora do ar</span>}
                    {m.text}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="team-pane team-board">
          {COLUMNS.map((col) => {
            const list = tasks.filter((t) => t.column === col);
            return (
              <div className="team-col" key={col} data-column={col}>
                <h3>
                  <span>{COLUMN_LABELS[col].toUpperCase()}</span>
                  <span>{list.length}</span>
                </h3>
                {!list.length && <div className="team-col-empty">—</div>}
                {list.map((t) => {
                  const who = team.members.find((m) => m.id === t.assignee);
                  return (
                    <div className="team-task-card" key={t.id + t.updatedAt} data-task={t.id}>
                      <div className="t">{t.title}</div>
                      {t.note && <div className="note">{t.note}</div>}
                      <div className="m">
                        <span>{t.id}</span>
                        <span className="who">
                          {who && <ProviderIcon id={who.provider} small />}
                          {who?.name || ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
