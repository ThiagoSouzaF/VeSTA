import { memo } from 'react';
import { AlertCircle, Check, LoaderCircle, MessageSquare, RotateCcw, SkipForward, Clock, Link2 } from 'lucide-react';
import { ProviderIcon } from '../ProviderIcon';
import { PROVIDERS } from '../../lib/constants';
import { modelLabel, formatElapsed } from '../../lib/format';
import { useNow } from '../../hooks/useNow';
import { BOARD_COLUMNS, MODE_LABEL, STEP_STATUS, columns } from '../../lib/quests';

const SNIPPET = 220;
const snippet = (t) => (t.length > SNIPPET ? t.slice(0, SNIPPET - 1) + '…' : t);

function Elapsed({ step }) {
  const live = step.status === 'running';
  const now = useNow(live, 1000);
  if (!step.startedAt) return null;
  const end = live ? now : step.endedAt || step.startedAt;
  return (
    <span className="quest-time" title="Tempo na etapa">
      <Clock size={11} />
      {formatElapsed(end - step.startedAt)}
    </span>
  );
}

const sameStep = (a, b) =>
  a.questId === b.questId &&
  a.depTitles === b.depTitles &&
  a.canAct === b.canAct &&
  a.onOpen === b.onOpen &&
  a.onAct === b.onAct &&
  [
    'id',
    'title',
    'status',
    'provider',
    'model',
    'mode',
    'kind',
    'chatId',
    'result',
    'startedAt',
    'endedAt',
    'attempts',
  ].every((k) => a.step[k] === b.step[k]);

// One step. Memoized on the step's own fields: a snapshot that did not touch it does not re-render it.
const StepCard = memo(function StepCard({ questId, step, depTitles, canAct, onOpen, onAct }) {
  return (
    <article className={'step-card ' + step.status} data-step={step.id} data-status={step.status}>
      <header>
        <ProviderIcon id={step.provider} small />
        <strong title={step.title}>{step.title}</strong>
        {step.status === 'running' ? (
          <LoaderCircle size={13} className="spin step-state" />
        ) : step.status === 'done' ? (
          <Check size={13} className="step-state ok" />
        ) : step.status === 'error' ? (
          <AlertCircle size={13} className="step-state err" />
        ) : null}
      </header>
      <div className="step-meta">
        <span>{PROVIDERS[step.provider]?.name}</span>
        <span>{modelLabel(step.model)}</span>
        <span>{MODE_LABEL[step.mode]}</span>
        {step.kind === 'review' && <span className="step-tag">revisão</span>}
        {step.status === 'skipped' && <span className="step-tag">{STEP_STATUS.skipped.toLowerCase()}</span>}
        {step.attempts > 1 && <span className="step-tag">tentativa {step.attempts}</span>}
        <Elapsed step={step} />
      </div>
      {depTitles && (
        <div className="step-deps" title="Espera por estas etapas">
          <Link2 size={11} />
          {depTitles}
        </div>
      )}
      {step.result && <p className={'step-result' + (step.status === 'error' ? ' err' : '')}>{snippet(step.result)}</p>}
      <footer>
        {step.chatId && (
          <button className="step-link" onClick={() => onOpen(step.chatId)} data-action="open-chat">
            <MessageSquare size={12} />
            Abrir chat
          </button>
        )}
        {canAct && step.status === 'error' && (
          <button className="step-link" onClick={() => onAct('retryStep', questId, step.id)} data-action="retry">
            <RotateCcw size={12} />
            Tentar de novo
          </button>
        )}
        {canAct && (step.status === 'error' || step.status === 'pending') && (
          <button className="step-link" onClick={() => onAct('skipStep', questId, step.id)} data-action="skip">
            <SkipForward size={12} />
            Pular
          </button>
        )}
      </footer>
    </article>
  );
}, sameStep);

// The quest as a board: Pendentes / Rodando / Concluídas / Problemas.
export function QuestBoard({ quest, onOpen, onAct }) {
  const cols = columns(quest);
  const title = Object.fromEntries(quest.steps.map((s) => [s.id, s.title]));
  const canAct = quest.status !== 'done' && quest.status !== 'cancelled';
  return (
    <div className="quest-board" role="group" aria-label="Quadro da quest">
      {BOARD_COLUMNS.map(([id, name]) => (
        <section className={'quest-col ' + id} key={id} data-col={id}>
          <h3>
            {name}
            <span>{cols[id].length}</span>
          </h3>
          <div className="quest-col-cards">
            {cols[id].map((s) => (
              <StepCard
                key={s.id}
                questId={quest.id}
                step={s}
                depTitles={s.dependsOn
                  .map((d) => title[d])
                  .filter(Boolean)
                  .join(', ')}
                canAct={canAct}
                onOpen={onOpen}
                onAct={onAct}
              />
            ))}
            {!cols[id].length && <p className="quest-col-empty">—</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
