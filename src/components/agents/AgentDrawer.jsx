// One agent in a drawer: what it does, run now or stop, its diary (every run is a conversation that opens) and the
// settings. A new agent opens the drawer straight on the form. Esc or the X closes it.
import { useEffect, useState } from 'react';
import { X, Play, Square, MessageSquare, Pencil } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { MODES } from '../../lib/modes';
import { modelLabel } from '../../lib/format';
import { ProviderIcon } from '../ProviderIcon';
import { Switch } from '../skills/SkillBits';
import { AgentForm } from './AgentForm';
import { AgentLearning } from './AgentLearning';
import { RefinePanel } from '../refine/RefinePanel';
import {
  STATUS,
  TRIGGER,
  agoLabel,
  describeSchedule,
  duration,
  lastRun,
  statusOf,
  untilLabel,
  whenLabel,
} from '../../lib/agents';

export function AgentDrawer({
  agent: a,
  draft,
  state,
  data,
  integrations,
  now,
  call,
  setData,
  notify,
  onClose,
  onCreated,
  onOpenChat,
  onOpenRefine,
}) {
  const isNew = !a;
  const [editing, setEditing] = useState(isNew);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const act = async (method, args, message) => {
    setBusy(true);
    try {
      const r = await call(method, args);
      setData(r.state || r);
      if (message) notify(message);
      return r;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  };
  const save = async (form) => {
    if (isNew) {
      const r = await act('agentCreate', form, 'Agent "' + form.name.trim() + '" criado');
      if (r) onCreated(r.id);
    } else if (await act('agentUpdate', { id: a.id, ...form }, 'Agent salvo')) setEditing(false);
  };
  const status = a ? statusOf(a, data.chats) : 'new';
  const last = a ? lastRun(a) : null;
  const running = status === 'running' || status === 'waiting';
  const project = a && data.projects.find((p) => p.id === a.projectId);
  return (
    <>
      <div className="skill-drawer-scrim" data-state={state} onClick={onClose} />
      <aside
        className="agent-drawer"
        data-state={state}
        aria-label={isNew ? 'Novo agent' : 'Agent ' + a.name}
        data-agent={a?.name || ''}
      >
        <div className="agent-drawer-head">
          <div>
            <div className="agent-kicker">{isNew ? 'AGENT MODE' : 'AGENT'}</div>
            <h2>{isNew ? 'Novo agent' : a.name}</h2>
            {!isNew && (
              <span className={'agent-status ' + status}>
                <i />
                {STATUS[status]}
              </span>
            )}
          </div>
          {!isNew && (
            <Switch
              on={a.enabled}
              label={(a.enabled ? 'Desligar ' : 'Ligar ') + a.name}
              onChange={(on) => act('agentToggle', { id: a.id, enabled: on }, a.name + (on ? ' ativo' : ' inativo'))}
            />
          )}
          <button className="skill-close" aria-label="Fechar" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {editing ? (
          <AgentForm
            key={a?.id || 'new'}
            initial={a || draft}
            isNew={isNew}
            busy={busy}
            integrations={integrations}
            projects={data.projects}
            skills={data.skills?.list || []}
            onSave={save}
            onCancel={() => (isNew ? onClose() : setEditing(false))}
            onRemove={
              isNew
                ? null
                : () =>
                    confirm
                      ? act('agentRemove', { id: a.id }, 'Agent "' + a.name + '" apagado').then((r) => r && onClose())
                      : (setConfirm(true), notify('Clique de novo em "Apagar agent" para confirmar'))
            }
          />
        ) : (
          <>
            <blockquote className="agent-prompt">{a.prompt}</blockquote>
            <dl className="agent-dl">
              <dt>QUEM FAZ</dt>
              <dd>
                <ProviderIcon id={a.provider} small /> {PROVIDERS[a.provider]?.name}
                {a.model && <small> · {modelLabel(a.model)}</small>}
              </dd>
              <dt>ONDE</dt>
              <dd>{project ? project.name : 'Espaço pessoal'}</dd>
              <dt>QUANDO</dt>
              <dd>
                {describeSchedule(a.schedule)}
                {a.enabled && a.nextRunAt && (
                  <small>
                    {' '}
                    · próxima {whenLabel(a.nextRunAt, now)} ({untilLabel(a.nextRunAt, now)})
                  </small>
                )}
              </dd>
              <dt>PODE</dt>
              <dd>
                {MODES[a.mode]?.label}
                <small>
                  {' '}
                  · memória {a.memory ? 'sim' : 'não'} · skills {a.skills ? 'sim' : 'não'}
                </small>
              </dd>
              {(a.skillNames || []).length > 0 && (
                <>
                  <dt>SKILLS</dt>
                  <dd className="agent-skill-chips">
                    {a.skillNames.map((n) => (
                      <span key={n} className="agent-skill-chip">
                        /{n}
                      </span>
                    ))}
                  </dd>
                </>
              )}
            </dl>
            <div className="agent-actions">
              {running ? (
                <button
                  className="danger-button"
                  onClick={() => act('stop', { chatId: last.chatId }, 'Parando ' + a.name)}
                  disabled={busy}
                >
                  <Square size={14} />
                  Parar
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => act('agentRun', { id: a.id }, a.name + ' começou')}
                >
                  <Play size={14} />
                  Rodar agora
                </button>
              )}
              {running && (
                <button className="secondary-button" onClick={() => onOpenChat(last.chatId)}>
                  <MessageSquare size={14} />
                  {status === 'waiting' ? 'Aprovar na conversa' : 'Acompanhar'}
                </button>
              )}
              <button className="secondary-button" onClick={() => setEditing(true)}>
                <Pencil size={14} />
                Configurar
              </button>
            </div>

            <AgentLearning agent={a} now={now} busy={busy} act={act} />

            <RefinePanel
              kind="agent"
              target={a}
              data={data}
              integrations={integrations}
              call={call}
              setData={setData}
              notify={notify}
              onOpenRefine={onOpenRefine}
            />

            <section className="agent-diary" aria-label="Diário">
              <h3>
                DIÁRIO{' '}
                <span>{a.runs.length ? a.runs.length + ' execuç' + (a.runs.length > 1 ? 'ões' : 'ão') : ''}</span>
              </h3>
              {!a.runs.length && <p className="agent-empty-line">Nenhuma execução ainda.</p>}
              <ol>
                {a.runs.map((r) => (
                  <li key={r.id} className={'agent-run-row ' + r.status} data-run={r.status}>
                    <span className="agent-run-dot" aria-hidden="true" />
                    <div>
                      <div className="agent-run-meta">
                        <b>{whenLabel(r.at, now)}</b>
                        <span>{TRIGGER[r.trigger] || r.trigger}</span>
                        {duration(r) && <span>{duration(r)}</span>}
                        <span className={'agent-status ' + (r.status === 'running' ? 'running' : r.status)}>
                          <i />
                          {r.status === 'running' ? 'rodando · ' + agoLabel(r.at, now) : STATUS[r.status]}
                        </span>
                      </div>
                      <p>
                        {r.status === 'error'
                          ? r.error || 'Falhou.'
                          : r.summary || (r.status === 'running' ? 'Trabalhando…' : 'Sem resumo.')}
                      </p>
                    </div>
                    {r.chatId && data.chats.some((c) => c.id === r.chatId) && (
                      <button className="text-link" onClick={() => onOpenChat(r.chatId)}>
                        Abrir conversa
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </aside>
    </>
  );
}
