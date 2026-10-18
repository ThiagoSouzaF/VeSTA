import { action } from '../lib/api';
import { Terminal } from 'lucide-react';
export function FloatingTerminal({ call, chat }) {
  return (
    <button
      className="floating-terminal"
      title="Retomar esta conversa no terminal nativo"
      aria-label="Retomar no terminal"
      onClick={action(() => call('openTerminal', { chatId: chat.id }))}
    >
      <Terminal size={15} />
    </button>
  );
}
