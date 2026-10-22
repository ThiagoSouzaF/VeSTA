import { memo } from 'react';
import { LayoutGrid, MessageSquare, Swords } from 'lucide-react';
import { StatusBadge } from './QuestDetail';

const STEP_LABEL = { pending: 'pendente', running: 'rodando', done: 'feita', error: 'com problema', skipped: 'pulada' };

// Shown above a chat that belongs to a quest. In the quest's own chat it lists every step chat, so the person can walk
// through them; in a step chat it leads back to the quest chat. Quest chats stay out of the Conversas list.
export const QuestChatBar = memo(function QuestChatBar({ chat, quest, onOpenQuest, onOpenChat }) {
  if (!quest) return null;
  const lead = chat.id === quest.leadChatId || chat.questRole === 'lead';
  const step = lead ? null : quest.steps.find((s) => s.chatId === chat.id);
  return (
    <nav className="quest-chat-bar" aria-label="Navegação da quest" data-quest={quest.id}>
      <div className="quest-chat-bar-head">
        <Swords size={14} />
        <span className="eyebrow">{lead ? 'CHAT DA QUEST' : 'ETAPA DA QUEST'}</span>
        <strong className="truncate">{step ? quest.title + ' — ' + step.title : quest.title}</strong>
        <StatusBadge status={quest.status} />
        <span className="quest-chat-bar-actions">
          {!lead && (
            <button className="step-link" data-action="open-quest-chat" onClick={() => onOpenChat(null, quest.id)}>
              <MessageSquare size={12} />
              Chat da quest
            </button>
          )}
          <button className="step-link" data-action="open-board" onClick={() => onOpenQuest(quest.id)}>
            <LayoutGrid size={12} />
            Quadro
          </button>
        </span>
      </div>
      {lead && quest.steps.length > 0 && (
        <div className="quest-chat-steps" role="list" aria-label="Chats das etapas">
          {quest.steps.map((s) => (
            <button
              key={s.id}
              role="listitem"
              className={'quest-chat-step ' + s.status}
              data-step={s.id}
              disabled={!s.chatId}
              title={s.chatId ? 'Abrir o chat desta etapa' : 'Esta etapa ainda não começou'}
              onClick={() => onOpenChat(s.chatId)}
            >
              <i className="dot" aria-hidden />
              <span className="truncate">{s.title}</span>
              <small>{STEP_LABEL[s.status]}</small>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
});
