import { X } from 'lucide-react';
import { attachmentUrl, fmtSize, typeLabel } from '../lib/attachments';
import { AttachmentIcon } from './AttachmentIcon';
// Attachments waiting to be sent: thumbnail (image) or icon + name + size (document), with a remove button.
export function AttachmentChips({ items, onRemove, disabled }) {
  if (!items?.length) return null;
  return (
    <ul className="attachment-chips" aria-label="Anexos pendentes">
      {items.map((a) => (
        <li className={'attachment-chip ' + a.kind} key={a.id} data-testid="attachment-chip">
          {a.kind === 'image' ? (
            <img src={attachmentUrl(a.scope, a, true)} alt="" decoding="async" />
          ) : (
            <AttachmentIcon a={a} size={18} />
          )}
          <span className="attachment-meta">
            <strong title={a.name}>{a.name}</strong>
            <small>
              {typeLabel(a)} · {fmtSize(a.size)}
            </small>
          </span>
          <button
            type="button"
            className="attachment-remove"
            aria-label={'Remover anexo ' + a.name}
            title="Remover"
            disabled={disabled}
            onClick={() => onRemove(a.id)}
          >
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}
