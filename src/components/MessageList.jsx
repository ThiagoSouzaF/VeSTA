import { ProviderIcon } from './ProviderIcon';
import { PROVIDERS } from '../lib/constants';
import { Message } from './Message';
export function MessageList({ chat, call, notify, setModal, bottom }) {
  return (
    <div className="messages">
      {!chat.messages.length && (
        <div className="conversation-empty">
          <ProviderIcon id={chat.provider} />
          <h3>Uma nova perspectiva começa aqui.</h3>
          <p>Converse com {PROVIDERS[chat.provider].name}. O contexto fica neste chat.</p>
        </div>
      )}
      {chat.messages.map((m) => (
        <Message key={m.id} m={m} chat={chat} call={call} notify={notify} setModal={setModal} />
      ))}
      <div ref={bottom} />
    </div>
  );
}
