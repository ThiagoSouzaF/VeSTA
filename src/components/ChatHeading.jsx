import { PROVIDERS } from '../lib/constants';
import { ProviderIcon } from './ProviderIcon';
import { MODES, modeOf } from '../lib/modes';
import { IconButton } from './IconButton';
import { Download, Trash2, Pencil } from 'lucide-react';
import { action } from '../lib/api';
import { Chapter } from './Chapter';
export function ChatHeading({ chat, currentProject, setModal, call, running }) {
  return (
    <div className="chat-heading">
      <div>
        <Chapter n={1} title={'CONVERSA · ' + PROVIDERS[chat.provider].engine.toUpperCase()} />
        <div className="eyebrow">CONVERSA · {PROVIDERS[chat.provider].engine.toUpperCase()}</div>
        <h2>{chat.title}</h2>
        <div className="chat-meta">
          <ProviderIcon id={chat.provider} small />
          <span>{PROVIDERS[chat.provider].name}</span>
          <span>·</span>
          <span>{currentProject?.name || 'Espaço pessoal'}</span>
          <span>·</span>
          <span>{MODES[modeOf(chat.mode)].label}</span>
        </div>
      </div>
      <div className="row">
        <IconButton
          icon={Pencil}
          label="Renomear chat"
          onClick={() => setModal({ type: 'rename', id: chat.id, title: chat.title })}
        />
        <IconButton
          icon={Download}
          label="Exportar conversa"
          onClick={action(() => call('exportChat', { id: chat.id }))}
        />
        <IconButton
          icon={Trash2}
          label="Excluir conversa"
          disabled={running}
          onClick={() => setModal({ type: 'delete-chat', id: chat.id, title: chat.title })}
        />
      </div>
    </div>
  );
}
