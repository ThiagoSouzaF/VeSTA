// What an agent learned, in its drawer: the task it suggests (used only on a yes), the lessons waiting for a yes (from
// its runs or from a correction in the chat), the ones that count, and a lesson the person writes. Only kept lessons
// reach the next runs.
import { useState } from 'react';
import { Check, Lightbulb, Plus, Trash2, Wand2 } from 'lucide-react';
import { agoLabel, keptLessons, pendingLessons } from '../../lib/agents';

const FROM = { run: 'numa execução', chat: 'na conversa, com você', person: 'você ensinou' };

export function AgentLearning({ agent: a, now, busy, act }) {
  const [text, setText] = useState('');
  const pending = pendingLessons(a);
  const kept = keptLessons(a);
  const lesson = (args, message) => act('agentLesson', { id: a.id, ...args }, message);
  const add = async (e) => {
    e.preventDefault();
    if (text.trim() && (await lesson({ action: 'add', text }, 'Lição guardada'))) setText('');
  };
  return (
    <section className="agent-learning" aria-label="Aprendizado">
      <h3>
        APRENDEU{' '}
        <span>
          {kept.length} valendo{pending.length ? ' · ' + pending.length + ' para revisar' : ''}
        </span>
      </h3>

      {a.suggestion && (
        <div className="agent-suggestion" data-suggestion>
          <div className="agent-learn-meta">
            <Wand2 size={14} />
            <b>Pedido sugerido pelo agent</b>
            <span>{agoLabel(a.suggestion.at, now)}</span>
          </div>
          <p>{a.suggestion.text}</p>
          <div className="agent-learn-actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => act('agentSuggestion', { id: a.id, accept: true }, 'O agent usa o pedido novo')}
            >
              <Check size={14} />
              Usar este pedido
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => act('agentSuggestion', { id: a.id, accept: false }, 'Sugestão dispensada')}
            >
              Dispensar
            </button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="agent-lessons pending">
          {pending.map((l) => (
            <li key={l.id} data-lesson="pending">
              <Lightbulb size={14} aria-hidden="true" />
              <div>
                <p>{l.text}</p>
                <small>
                  {FROM[l.from] || l.from} · {agoLabel(l.at, now)}
                </small>
              </div>
              <button
                className="secondary-button"
                disabled={busy}
                aria-label={'Manter a lição: ' + l.text}
                onClick={() => lesson({ action: 'keep', lessonId: l.id }, 'Lição mantida: vale nas próximas')}
              >
                <Check size={14} />
                Manter
              </button>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={'Apagar a lição: ' + l.text}
                title="Apagar"
                onClick={() => lesson({ action: 'drop', lessonId: l.id }, 'Lição apagada')}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {kept.length > 0 ? (
        <ul className="agent-lessons kept">
          {kept.map((l) => (
            <li key={l.id} data-lesson="kept">
              <Check size={14} aria-hidden="true" />
              <div>
                <p>{l.text}</p>
                <small>{FROM[l.from] || l.from}</small>
              </div>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={'Apagar a lição: ' + l.text}
                title="Apagar"
                onClick={() => lesson({ action: 'drop', lessonId: l.id }, 'Lição apagada')}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !pending.length && (
          <p className="agent-empty-line">
            Ainda nada. Quando errar, acertar um caminho ou for corrigido na conversa, o agent propõe uma lição aqui.
          </p>
        )
      )}

      <form className="agent-teach" onSubmit={add}>
        <input
          value={text}
          maxLength={240}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ensine algo a este agent (vale já na próxima)"
          aria-label="Ensinar uma lição"
        />
        <button className="secondary-button" type="submit" disabled={busy || !text.trim()}>
          <Plus size={14} />
          Ensinar
        </button>
      </form>
    </section>
  );
}
