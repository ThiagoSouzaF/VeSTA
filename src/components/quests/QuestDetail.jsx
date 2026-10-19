import { memo, useState } from 'react';
import { ArrowLeft, Ban, LoaderCircle, MessageSquare, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { QUEST_STATUS, clock, progress } from '../../lib/quests';
import { QuestBoard } from './QuestBoard';
import { PlanEditor } from './PlanEditor';
import { Chapter } from '../Chapter';

export const StatusBadge = ({ status }) => (
  <span className={'quest-status ' + status} data-status={status}>
    {QUEST_STATUS[status]}
  </span>
);
export const ProgressBar = ({ p }) => (
  <div
    className="quest-progress"
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={p.pct}
    aria-label="Progresso"
  >
    <span style={{ width: p.pct + '%' }} className={p.errors ? 'err' : ''} />
  </div>
);

const Log = memo(function Log({ log }) {
  return (
    <section className="quest-log" aria-label="Diário da quest">
      <h3>Diário</h3>
      <ol>
        {[...log].reverse().map((e, i) => (
          <li key={log.length - i}>
            <time>{clock(e.at)}</time>
            {e.text}
          </li>
        ))}
      </ol>
    </section>
  );
});

// One quest: controls, planning state, plan editor (draft) or board, summary and journal.
export function QuestDetail({ quest, projects, integrations, onBack, onOpenChat, call, onAct, notify }) {
  const [busy, setBusy] = useState(false),
    [confirmCancel, setConfirmCancel] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const p = progress(quest),
    project = projects.find((x) => x.id === quest.projectId);
  const planning = quest.planning;
  const wait = async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const act = (method, extra) => wait(() => onAct(method, quest.id, undefined, extra));
  const live = quest.status === 'running' || quest.status === 'paused';
  return (
    <div className="content-page quest-detail" data-quest={quest.id}>
      <button className="quest-back" onClick={onBack}>
        <ArrowLeft size={14} />
        Todas as quests
      </button>
      <div className="page-heading quest-heading">
        <div>
          <Chapter n={3} title="QUESTS // QUADRO" />
          <h1>{quest.title}</h1>
          <p>
            <StatusBadge status={quest.status} />
            {project ? ' · ' + project.name : ' · Espaço pessoal'} · {p.done}/{p.total} etapas · até {quest.maxParallel}{' '}
            em paralelo
          </p>
        </div>
        <div className="quest-controls" role="toolbar" aria-label="Controles da quest">
          {quest.status === 'running' && (
            <button className="secondary-button" data-action="pause" disabled={busy} onClick={() => act('pauseQuest')}>
              <Pause size={14} />
              Pausar
            </button>
          )}
          {quest.status === 'paused' && (
            <button className="primary-button" data-action="resume" disabled={busy} onClick={() => act('resumeQuest')}>
              <Play size={14} />
              Retomar
            </button>
          )}
          {live &&
            (confirmCancel ? (
              <button
                className="danger-button filled"
                data-action="cancel-confirm"
                disabled={busy}
                onClick={() => act('cancelQuest').then(() => setConfirmCancel(false))}
              >
                <Ban size={14} />
                Confirmar cancelamento
              </button>
            ) : (
              <button className="danger-button" data-action="cancel" onClick={() => setConfirmCancel(true)}>
                <Ban size={14} />
                Cancelar
              </button>
            ))}
          {quest.status !== 'running' &&
            (confirmDelete ? (
              <button
                className="danger-button filled"
                disabled={busy}
                onClick={() => wait(() => call('deleteQuest', { id: quest.id }).then(onBack))}
              >
                <Trash2 size={14} />
                Excluir de vez
              </button>
            ) : (
              <button className="danger-button" data-action="delete" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
                Excluir
              </button>
            ))}
        </div>
      </div>
      <ProgressBar p={p} />
      <section className="quest-brief">
        <div>
          <span className="eyebrow">OBJETIVO</span>
          <p>{quest.goal}</p>
        </div>
        {quest.guidelines && (
          <div>
            <span className="eyebrow">DIRETRIZES</span>
            <p>{quest.guidelines}</p>
          </div>
        )}
      </section>
      {planning?.status === 'running' && (
        <div className="quest-banner" role="status">
          <LoaderCircle size={15} className="spin" />
          <span>
            {PROVIDERS[planning.provider]?.name || 'A IA'} está montando o plano. Em instantes você poderá revisar e
            editar.
          </span>
          <button className="step-link" onClick={() => onOpenChat(planning.chatId)}>
            <MessageSquare size={12} />
            Ver o chat
          </button>
        </div>
      )}
      {planning?.status === 'error' && quest.status === 'draft' && (
        <div className="quest-banner err" role="alert">
          <span>Não consegui montar o plano: {planning.error}</span>
          <button
            className="step-link"
            disabled={busy}
            onClick={() => act('replan', { provider: planning.provider, model: '' })}
          >
            <RefreshCw size={12} />
            Planejar de novo
          </button>
          <button className="step-link" onClick={() => onOpenChat(planning.chatId)}>
            <MessageSquare size={12} />
            Ver o chat
          </button>
        </div>
      )}
      {planning?.warnings?.length > 0 && quest.status === 'draft' && (
        <div className="quest-banner" role="note">
          {planning.warnings.join(' ')}
        </div>
      )}
      {quest.status === 'draft' ? (
        <PlanEditor
          key={quest.id + ':' + quest.updatedAt}
          quest={quest}
          integrations={integrations}
          busy={busy || planning?.status === 'running'}
          onSave={(steps) => wait(() => onAct('updateQuest', quest.id, undefined, { steps }))}
          onStart={(steps) => wait(() => onAct('startQuest', quest.id, undefined, { steps }))}
        />
      ) : (
        <QuestBoard quest={quest} onOpen={onOpenChat} onAct={onAct} />
      )}
      {quest.status === 'done' && quest.summary && (
        <section className="quest-summary" aria-label="Resumo final">
          <h3>Resumo final</h3>
          <pre>{quest.summary}</pre>
        </section>
      )}
      {quest.status === 'paused' && quest.pauseReason === 'error' && (
        <p className="quest-hint">
          A quest está pausada por causa de uma etapa com problema. Tente de novo ou pule a etapa; as demais seguem.
        </p>
      )}
      <Log log={quest.log} />
    </div>
  );
}
