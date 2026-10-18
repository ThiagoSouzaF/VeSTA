import { ArrowDown } from 'lucide-react';
import { ProviderIcon } from './ProviderIcon';
import { PROVIDERS } from '../lib/constants';
import { Message } from './Message';
import { useAutoScroll } from '../hooks/useAutoScroll';
export function MessageList({ chat, call, notify, setModal }) {
  const last = chat.messages.at(-1);
  const { scroller, content, atBottom, unread, onScroll, onWheel, goEnd } = useAutoScroll({
    chatId: chat.id,
    messages: chat.messages.filter((m) => m.role !== 'user').length,
    activity: (last?.activities?.length || 0) + (last?.subagents?.length || 0),
    sent: chat.messages.filter((m) => m.role === 'user').length,
  });
  return (
    <div className="messages-wrap">
      <div className="messages" ref={scroller} onScroll={onScroll} onWheel={onWheel}>
        <div ref={content}>
          {!chat.messages.length && (
            <div className="conversation-empty">
              <ProviderIcon id={chat.provider} />
              <h3>Uma nova perspectiva começa aqui.</h3>
              <p>Converse com {PROVIDERS[chat.provider].name}. O contexto fica neste chat.</p>
            </div>
          )}
          {chat.messages.map((m) => (
            <Message
              key={m.id}
              m={m}
              provider={chat.provider}
              title={chat.title}
              projectId={chat.projectId}
              call={call}
              notify={notify}
              setModal={setModal}
            />
          ))}
        </div>
      </div>
      {!atBottom && (
        <button
          className="scroll-end"
          onClick={goEnd}
          title="Ir ao fim da conversa (End)"
          aria-label={unread ? 'Ir ao fim, ' + unread + ' novidades' : 'Ir ao fim da conversa'}
        >
          <ArrowDown size={16} />
          {unread > 0 && <span className="scroll-end-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
    </div>
  );
}
