import { ConversationTree } from './ConversationTree';
import { action } from '../lib/api';

// The Conversas drawer beside the rail: the tree of chats by project. It closes to give the chat the whole width.
export function ConversationDrawer({ addProject, ...tree }) {
  return (
    <aside className="conversation-drawer" aria-label="Conversas">
      <ConversationTree {...tree} addProject={action(addProject)} />
    </aside>
  );
}
