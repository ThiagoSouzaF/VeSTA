import { useMemo, useState } from 'react';
import { ArrowLeft, Ban, Check, LoaderCircle, Pause, Play, Plus, RotateCcw, SkipForward, Sparkles } from 'lucide-react';
import { Badge, Empty, Sheet } from '../components/ui';
import { ProviderIcon } from '../../../src/components/ProviderIcon';
import { PROVIDERS } from '../../../src/lib/constants';
import { BOARD_COLUMNS, MODE_LABEL, QUEST_STATUS, STEP_STATUS, columns, progress } from '../../../src/lib/quests';
import { formatDate, modelLabel } from '../../../src/lib/format';

const Progress = ({ p }) => (
  <div className="progress" role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100}>
    <i style={{ width: p.pct + '%' }} />
  </div>
);
const tone = { running: 'live', paused: 'warn', failed: 'bad', done: 'good', cancelled: '' };

export function QuestsScreen({ quests, projects, onOpen, onCreate }) {
  const [creating, setCreating] = useState(false);
  const names = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  return (
    <>
      {quests.length ? (
        <ul className="quest-list">
          {quests.map((q) => {
            const p = progress(q);
            return (
              <li key={q.id}>
                <button className="quest-row" data-quest={q.id} onClick={() => onOpen(q.id)}>
                  <span className="quest-row-top">
                    <strong className="truncate">{q.title}</strong>
                    <Badge tone={tone[q.status]}>{QUEST_STATUS[q.status]}</Badge>
                  </span>
                  <Progress p={p} />
                  <span className="muted small">
                    {p.done}/{p.total} etapas{p.running ? ' · ' + p.running + ' rodando' : ''}
                    {p.errors ? ' · ' + p.errors + ' com problema' : ''} · {names[q.projectId] || 'Espaço pessoal'} ·{' '}
                    {formatDate(q.updatedAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty mascot title="Nenhuma quest">
          Uma quest reúne várias IAs trabalhando juntas em um objetivo.
        </Empty>
      )}
      <button className="fab" onClick={() => setCreating(true)} aria-label="Nova quest">
        <Plus size={26} />
      </button>
      {creating && <NewQuest projects={projects} onClose={() => setCreating(false)} onCreate={onCreate} />}
    </>
  );
}

function NewQuest({ projects, onClose, onCreate }) {
  const [title, setTitle] = useState(''),
    [goal, setGoal] = useState(''),
    [projectId, setProjectId] = useState(''),
    [planner, setPlanner] = useState('claude'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function create() {
    setBusy(true);
    setError('');
    try {
      await onCreate({
        title: title.trim(),
        goal: goal.trim(),
        projectId: projectId || null,
        plan: { provider: planner },
      });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Sheet title="Nova quest" onClose={onClose}>
      <label className="field">
        <span className="label">Título</span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Objetivo</span>
        <textarea rows={4} value={goal} maxLength={8000} onChange={(e) => setGoal(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Projeto</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Espaço pessoal</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">IA que vai planejar</span>
        <select value={planner} onChange={(e) => setPlanner(e.target.value)}>
          {['claude', 'codex', 'opencode'].map((id) => (
            <option key={id} value={id}>
              {PROVIDERS[id].name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn primary big" disabled={busy || !title.trim() || !goal.trim()} onClick={create}>
        <Sparkles size={18} /> Criar e planejar
      </button>
    </Sheet>
  );
}

const StepIcon = ({ status }) =>
  status === 'running' ? <LoaderCircle size={14} className="spin" /> : status === 'done' ? <Check size={14} /> : null;

export function QuestDetailScreen({ quest, projects, onBack, onAct, onOpenChat }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const run = async (method, extra) => {
    setBusy(true);
    setError('');
    try {
      await onAct(method, { id: quest.id, ...extra });
      setConfirm(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const p = progress(quest),
    cols = columns(quest),
    byId = Object.fromEntries(quest.steps.map((s) => [s.id, s]));
  const project = projects.find((x) => x.id === quest.projectId);
  const planning = quest.planning?.status === 'running';
  return (
    <div className="quest-detail" data-quest={quest.id}>
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar">
          <ArrowLeft size={22} />
        </button>
        <div className="topbar-title">
          <strong className="truncate">{quest.title}</strong>
          <span className="muted truncate">
            {QUEST_STATUS[quest.status]} · {project?.name || 'Espaço pessoal'} · {p.done}/{p.total} etapas
          </span>
        </div>
      </header>
      <div className="scroll">
        <Progress p={p} />
        <div className="controls" role="toolbar" aria-label="Controles da quest">
          {quest.status === 'draft' && quest.steps.length > 0 && !planning && (
            <button className="btn primary" disabled={busy} onClick={() => run('startQuest')} data-action="start">
              <Play size={16} /> Iniciar
            </button>
          )}
          {quest.status === 'running' && (
            <button className="btn" disabled={busy} onClick={() => run('pauseQuest')} data-action="pause">
              <Pause size={16} /> Pausar
            </button>
          )}
          {quest.status === 'paused' && (
            <button className="btn primary" disabled={busy} onClick={() => run('resumeQuest')} data-action="resume">
              <Play size={16} /> Retomar
            </button>
          )}
          {['draft', 'running', 'paused'].includes(quest.status) &&
            (confirm ? (
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => run('cancelQuest')}
                data-action="cancel-confirm"
              >
                <Ban size={16} /> Confirmar cancelamento
              </button>
            ) : (
              <button className="btn ghost" onClick={() => setConfirm(true)} data-action="cancel">
                <Ban size={16} /> Cancelar
              </button>
            ))}
          {quest.status === 'draft' && !planning && (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => run('replan', { provider: quest.planning?.provider || 'claude' })}
            >
              <Sparkles size={16} /> Planejar de novo
            </button>
          )}
        </div>
        {planning && (
          <p className="notice">
            <LoaderCircle size={14} className="spin" /> Planejando com {PROVIDERS[quest.planning.provider]?.name}…
          </p>
        )}
        {quest.planning?.status === 'error' && quest.status === 'draft' && (
          <p className="form-error">Falha no planejamento: {quest.planning.error}</p>
        )}
        {quest.status === 'paused' && quest.pauseReason === 'error' && (
          <p className="notice">Pausada por um problema numa etapa. Tente de novo ou pule a etapa.</p>
        )}
        {error && <p className="form-error">{error}</p>}
        <section className="brief">
          <span className="label">OBJETIVO</span>
          <p>{quest.goal}</p>
        </section>
        {quest.status === 'done' && quest.summary && (
          <section className="brief">
            <span className="label">RESUMO</span>
            <p>{quest.summary}</p>
          </section>
        )}
        {BOARD_COLUMNS.map(([id, name]) => {
          const steps = cols[id === 'problems' ? 'problems' : id];
          if (!steps.length) return null;
          return (
            <section className={'board-col ' + id} key={id} data-column={id}>
              <h3>
                {name} <span>{steps.length}</span>
              </h3>
              {steps.map((s) => (
                <article className={'step ' + s.status} key={s.id} data-step={s.id}>
                  <div className="step-top">
                    <ProviderIcon id={s.provider} small />
                    <strong>{s.title}</strong>
                    <StepIcon status={s.status} />
                  </div>
                  <span className="muted small">
                    {PROVIDERS[s.provider]?.name} · {modelLabel(s.model)} · {MODE_LABEL[s.mode]} ·{' '}
                    {STEP_STATUS[s.status]}
                  </span>
                  {s.dependsOn.length > 0 && (
                    <span className="muted small">
                      Depende de: {s.dependsOn.map((d) => byId[d]?.title || d).join(', ')}
                    </span>
                  )}
                  {s.result && <p className="step-result">{s.result}</p>}
                  <div className="step-actions">
                    {s.chatId && (
                      <button className="btn small ghost" onClick={() => onOpenChat(s.chatId)}>
                        Abrir chat
                      </button>
                    )}
                    {s.status === 'error' && quest.status !== 'cancelled' && (
                      <button className="btn small" disabled={busy} onClick={() => run('retryStep', { stepId: s.id })}>
                        <RotateCcw size={13} /> Tentar de novo
                      </button>
                    )}
                    {['error', 'pending'].includes(s.status) && ['running', 'paused'].includes(quest.status) && (
                      <button
                        className="btn small ghost"
                        disabled={busy}
                        onClick={() => run('skipStep', { stepId: s.id })}
                      >
                        <SkipForward size={13} /> Pular
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
        {!quest.steps.length && !planning && (
          <p className="muted center">Sem etapas ainda. Planeje a quest para a IA montar o quadro.</p>
        )}
      </div>
    </div>
  );
}
