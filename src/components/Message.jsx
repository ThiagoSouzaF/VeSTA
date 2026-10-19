import { memo } from 'react';
import { ProviderIcon } from './ProviderIcon';
import { PROVIDERS } from '../lib/constants';
import { Brain, Copy, AlertCircle, Pin } from 'lucide-react';
import { Permissions } from './Permissions';
import { TaskSummary } from './TaskSummary';
import { Subagents } from './Subagents';
import { Markdown } from './Markdown';
import { IconButton } from './IconButton';
import { action } from '../lib/api';
import { MessageAttachments } from './MessageAttachments';
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
        {m.text && <Markdown text={m.text} />}
        {m.status === 'running' && !m.text && (
          <div className="thinking">
            <span />
            <span />
            <span />
            <small>{m.activities?.length || m.subagents?.length ? 'Preparando resposta' : 'Conectando à IA'}</small>
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
            <IconButton
              icon={Copy}
              label="Copiar resposta"
              onClick={action(async () => {
                await navigator.clipboard.writeText(m.text);
                notify('Resposta copiada');
              })}
            />
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
          </div>
        )}
      </div>
    </article>
  );
});
