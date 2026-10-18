import { useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';
import { Sheet } from './ui';
import { PROVIDERS } from '../../../src/lib/constants';

// Highlighted over everything: the AI is blocked until someone answers. One request at a time, oldest answered first
// would hide new ones, so the newest comes first and the count shows how many are waiting.
export function PermissionSheet({ items, onAnswer, onOpenChat }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!items.length) return null;
  const { chat, permission: p } = items[0];
  const answer = async (decision) => {
    setBusy(true);
    setError('');
    try {
      await onAnswer(p.id, decision);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Pedido de permissão" urgent>
      <div className="perm" data-permission={p.id}>
        <div className="perm-head">
          <ShieldAlert size={22} />
          <div>
            <strong>
              {p.subagent ? 'Subagente ' + p.subagent : PROVIDERS[chat.provider]?.name || 'A IA'} quer continuar
            </strong>
            <button className="link" onClick={() => onOpenChat(chat.id)}>
              {chat.title}
            </button>
          </div>
          {items.length > 1 && <span className="badge warn">+{items.length - 1}</span>}
        </div>
        <p className="perm-title">{p.title}</p>
        {p.command && <pre className="perm-command">{p.command}</pre>}
        {p.detail && <p className="perm-detail">{p.detail}</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="perm-actions">
          <button className="btn primary big" disabled={busy} onClick={() => answer('once')}>
            <Check size={18} /> Permitir
          </button>
          <button className="btn danger big" disabled={busy} onClick={() => answer('deny')}>
            <X size={18} /> Negar
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => answer('always')}>
            Sempre nesta conversa · {p.rule}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
