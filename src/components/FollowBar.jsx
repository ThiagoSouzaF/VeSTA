import { Eye, Octagon, Square } from 'lucide-react';
import { action } from '../lib/api';
import { useNow } from '../hooks/useNow';

// "Acompanhando 2 processos em segundo plano": the chat's Claude stays alive to hear when they finish.
// Also shows the one-line notice left when following ended (stopped, time limit, claude closed).
export function FollowBar({ chat, entry, call }) {
  const now = useNow(!!entry, 30000);
  if (!entry && !chat.notice) return null;
  if (!entry)
    return (
      <div className="follow-bar notice" role="status" data-testid="follow-notice">
        <Square size={14} />
        <span>{chat.notice.text}</span>
      </div>
    );
  const n = entry.tasks.length,
    minutes = Math.max(0, Math.round((entry.deadline - now) / 60000));
  return (
    <div className="follow-bar" role="status" data-testid="follow-bar">
      <div className="follow-head">
        <Eye size={15} />
        <strong>
          {n ? 'Acompanhando ' + n + (n === 1 ? ' processo' : ' processos') + ' em segundo plano' : 'Acompanhando'}
        </strong>
        <span className="follow-until">
          avisa quando terminar · limite em{' '}
          {minutes >= 60 ? Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min' : minutes + ' min'}
        </span>
        <button
          className="secondary-button follow-stop"
          onClick={action(() => call('stopFollowing', { chatId: chat.id }))}
          title="Fecha o Claude deste chat sem encerrar os processos"
        >
          Parar de acompanhar
        </button>
      </div>
      {n > 0 && (
        <ul className="follow-tasks">
          {entry.tasks.map((t) => (
            <li key={t.taskId}>
              <code>{t.description || t.taskId}</code>
              <button
                className="follow-task-stop"
                onClick={action(() => call('stopTask', { chatId: chat.id, taskId: t.taskId }))}
              >
                <Octagon size={12} />
                Parar processo
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
