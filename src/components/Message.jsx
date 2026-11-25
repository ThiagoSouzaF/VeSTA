import { memo } from 'react';
import { ProviderIcon } from './ProviderIcon';
import { PROVIDERS } from '../lib/constants';
import { Brain, AlertCircle, Pin, BellRing, BookOpen } from 'lucide-react';
import { messageSkills, splitSlash } from '../lib/skills';
import { tokensLabel, tokensTitle } from '../lib/tokens';
import { Permissions } from './Permissions';
import { TaskSummary } from './TaskSummary';
import { Subagents } from './Subagents';
import { Markdown } from './Markdown';
import { MessageAttachments } from './MessageAttachments';
import LatticeLoader from './bits/LatticeLoader';
import { CopyButton } from './CopyButton';

// The words under a running answer: still connecting, or the AI already started working.
const thinkingLabel = (m) => (m.activities?.length || m.subagents?.length ? 'Preparando resposta' : 'Conectando à IA');
// Props are stable between frames (primitives + stable callbacks), so only the message that changed re-renders.
export const Message = memo(function Message({
  m,
  chat,
  live,
  provider,
  title,
  projectId,
  call,
  notify,
  setModal,
  onStopTask,
}) {
  const skills = messageSkills(m);
  // The mentions that open the message become the chips; the ones in the middle stay in the text, where they were.
  const shown = m.text && (skills.length ? splitSlash(m.text, skills) : m.text);
  return (
    <article className={'message ' + m.role} id={'msg-' + m.id} data-message-id={m.id}>
      <div className="message-avatar">
        {m.role === 'user' ? <span>V</span> : <ProviderIcon id={m.provider || provider} small />}
      </div>
      <div className="message-body">
        <div className="message-author">
          <strong>{m.role === 'user' ? 'Você' : PROVIDERS[m.provider || provider].name}</strong>
          <time>
            {new Date(m.createdAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
          {m.auto && (
            <span
              className="message-auto"
              title="O Claude voltou sozinho depois que um processo em segundo plano terminou"
              data-testid="auto-return"
            >
              <BellRing size={11} />
              {m.auto === 'nudge'
                ? 'Retorno automático (VeSTA avisou)'
                : 'Retorno automático de processo em segundo plano'}
            </span>
          )}
          {m.memorySaved && (
            <span title="Trecho salvo no AI Memory">
              <Brain size={12} />
            </span>
          )}
        </div>
        <Permissions
          permissions={m.permissions}
          providerName={PROVIDERS[m.provider || provider].name}
          onAnswer={(id, decision) => call('answerPermission', { id, decision })}
        />
        {m.role === 'assistant' && <TaskSummary chat={chat} m={m} live={live} onStopTask={onStopTask} />}
        <Subagents subagents={m.subagents} />
        <MessageAttachments chatId={chat.id} attachments={m.attachments} call={call} />
        {skills.length > 0 && (
          <span className="skill-chips">
            {skills.map((name) => (
              <span key={name} className="skill-chip" title="Skill do VeSTA enviada inteira depois da mensagem">
                <BookOpen size={12} />/{name}
              </span>
            ))}
          </span>
        )}
        {shown && <Markdown text={shown} />}
        {m.status === 'running' && !m.text && (
          <div className="thinking">
            <LatticeLoader
              label={
                <span key={thinkingLabel(m)} className="t-swap">
                  {thinkingLabel(m)}
                </span>
              }
              spokenLabel={thinkingLabel(m)}
              fontSize={11}
              cellSize={4}
              gap={2}
            />
          </div>
        )}
        {m.error && (
          <div className="inline-error">
            <AlertCircle size={16} />
            <span>{m.error}</span>
          </div>
        )}
        {m.status === 'cancelled' && <small className="muted">Resposta interrompida</small>}
        {m.role === 'assistant' && m.text && m.status !== 'running' && (
          <div className="message-tools">
            <CopyButton text={m.text} label="Copiar resposta" onCopied={() => notify('Resposta copiada')} />
            <button
              onClick={() =>
                setModal({
                  type: 'memory',
                  title,
                  body: m.text,
                  kind: 'note',
                  projectId: projectId || '',
                })
              }
            >
              <Pin size={12} />
              Guardar como nota
            </button>
            {m.usage && (
              <span className="message-tokens" title={tokensTitle(m.usage)}>
                {tokensLabel(m.usage)}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
