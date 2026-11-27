// One agent in the overview: its state, name, AI and place, the schedule in words with the next time, the last result
// and its last runs as a strip (oldest left). Switch and "Rodar agora" act without opening it.
import { Clock, Play, Brain, BookOpen } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { MODES } from '../../lib/modes';
import { ProviderIcon } from '../ProviderIcon';
import { Switch } from '../skills/SkillBits';
import { STATUS, agoLabel, describeSchedule, lastRun, statusOf, toReview, untilLabel } from '../../lib/agents';
import { whereOf } from '../../lib/places';

export function AgentCard({ agent: a, chats, projects, now, selected, onOpen, onToggle, onRun }) {
  const status = statusOf(a, chats);
  const last = lastRun(a);
  const project = projects.find((p) => p.id === a.projectId);
  const history = (a.runs || []).slice(0, 12).reverse();
  const busy = status === 'running' || status === 'waiting';
  const review = toReview(a);
  const where = whereOf(a);
  const placeRunning = where.find((w) => w.running);
  return (
    <article
      className={'agent-card ' + status + (selected ? ' selected' : '')}
      data-agent={a.name}
      onClick={() => onOpen(a.id)}
    >
      <header>
        <span className={'agent-status ' + status}>
          <i />
          {STATUS[status]}
        </span>
        {a.unseen > 0 && <span className="agent-new">novo</span>}
        {review > 0 && (
          <span className="agent-review" title="Lições, pedido ou proposta de refino esperando o seu sim">
            {review} para revisar
          </span>
        )}
        <Switch
          on={a.enabled}
          label={(a.enabled ? 'Desligar ' : 'Ligar ') + a.name}
          onChange={(on) => onToggle(a, on)}
        />
      </header>
      <button className="agent-card-open" onClick={() => onOpen(a.id)}>
        <h3>{a.name}</h3>
      </button>
      <p className="agent-who">
        <ProviderIcon id={a.provider} small />
        {PROVIDERS[a.provider]?.name}
        <span>· {project ? project.name : 'Espaço pessoal'}</span>
      </p>
      <p className="agent-when">
        <Clock size={13} />
        {describeSchedule(a.schedule)}
        {a.enabled && a.nextRunAt && <b>{untilLabel(a.nextRunAt, now)}</b>}
      </p>
      <p className={'agent-last' + (last?.status === 'error' ? ' error' : '')}>
        {placeRunning
          ? 'Trabalhando em ' +
            placeRunning.label +
            ' · começou ' +
            agoLabel(a.places[placeRunning.id].running, now) +
            '…'
          : busy
            ? 'Trabalhando · começou ' + agoLabel(last.at, now) + '…'
            : last
              ? last.summary || last.error || 'Terminou sem resumo.'
              : 'Ainda não rodou. Use "Rodar agora" para ver como fica.'}
      </p>
      <p className="agent-where" aria-label="Onde roda">
        <span>ONDE</span>
        {where.map((w) => (
          <span
            key={w.id}
            className={'agent-loc ' + w.id + (w.running ? ' running' : '')}
            data-where={w.id}
            title={
              w.id === 'vesta'
                ? 'Roda com o VeSTA aberto, mesmo minimizado'
                : 'Roda pelo agendador, com o VeSTA fechado'
            }
          >
            <i />
            {w.label}
            {w.outdated && <em>desatualizado</em>}
          </span>
        ))}
      </p>
      <footer>
        <span className="agent-history" aria-label={'Últimas ' + history.length + ' execuções'}>
          {history.map((r) => (
            <i key={r.id} className={r.status} title={r.status === 'ok' ? r.summary : r.error || r.status} />
          ))}
        </span>
        <span className="agent-traits">
          <span className="agent-mode" title={MODES[a.mode]?.hint}>
            {MODES[a.mode]?.label}
          </span>
          {a.memory && <Brain size={13} aria-label="Usa a memória" />}
          {a.skills && <BookOpen size={13} aria-label="Usa as skills" />}
        </span>
        <button
          className="icon-button agent-run"
          aria-label={'Rodar ' + a.name + ' agora'}
          title="Rodar agora"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onRun(a);
          }}
        >
          <Play size={14} />
        </button>
      </footer>
    </article>
  );
}
