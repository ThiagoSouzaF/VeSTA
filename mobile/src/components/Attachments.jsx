import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { AttachmentIcon } from '../../../src/components/AttachmentIcon';
import { fmtSize, imagesOf, typeLabel } from '../../../src/lib/attachments';

// Image data comes through the authenticated call (the page's CSP allows data: images only), cached per attachment.
const cache = new Map();
function useImage(call, chatId, a, full) {
  const key = chatId + ':' + a.id + (full ? ':full' : '');
  const [src, setSrc] = useState(cache.get(key) || '');
  useEffect(() => {
    if (src || a.kind !== 'image') return;
    let alive = true;
    call('attachmentData', { chatId, id: a.id, ...(full ? { full: true } : {}) })
      .then((r) => {
        const url = 'data:' + r.mime + ';base64,' + r.data;
        cache.set(key, url);
        if (alive) setSrc(url);
      })
      .catch(() => alive && setSrc('error'));
    return () => {
      alive = false;
    };
  }, [key]);
  return src;
}
function Thumb({ call, chatId, a, onOpen }) {
  const src = useImage(call, chatId, a, false);
  return (
    <button type="button" className="m-att-thumb" aria-label={'Abrir imagem ' + a.name} onClick={onOpen}>
      {src && src !== 'error' ? <img src={src} alt={a.name} /> : <AttachmentIcon a={a} size={22} />}
    </button>
  );
}
function Viewer({ call, chatId, a, onClose }) {
  const src = useImage(call, chatId, a, true);
  return (
    <div className="m-viewer" role="dialog" aria-modal="true" aria-label={a.name} onClick={onClose}>
      <button type="button" className="m-viewer-close" aria-label="Fechar" onClick={onClose}>
        <X size={22} />
      </button>
      {src && src !== 'error' ? (
        <img src={src} alt={a.name} />
      ) : (
        <p className="muted">{src ? 'Sem pré-visualização' : 'Carregando…'}</p>
      )}
      <p className="m-viewer-caption">
        {a.name} · {fmtSize(a.size)}
      </p>
    </div>
  );
}
// Attachments of a sent message. Images open in a viewer; documents show only name and size (open them on the desktop).
export function MessageAttachments({ call, chatId, attachments }) {
  const [view, setView] = useState(null);
  if (!attachments?.length) return null;
  return (
    <div className="m-atts">
      {attachments.map((a) =>
        a.kind === 'image' ? (
          <Thumb key={a.id} call={call} chatId={chatId} a={a} onOpen={() => setView(a)} />
        ) : (
          <div className="m-att-card" key={a.id}>
            <AttachmentIcon a={a} size={20} />
            <span>
              <strong>{a.name}</strong>
              <small>
                {typeLabel(a)} · {fmtSize(a.size)}
              </small>
            </span>
          </div>
        )
      )}
      {view && imagesOf(attachments).includes(view) && (
        <Viewer call={call} chatId={chatId} a={view} onClose={() => setView(null)} />
      )}
    </div>
  );
}
// Chips of the files picked on the phone and already uploaded (waiting for the message to be sent).
export function PendingAttachments({ items, onRemove, disabled }) {
  if (!items.length) return null;
  return (
    <ul className="m-pending" aria-label="Anexos pendentes">
      {items.map(({ att, preview }) => (
        <li key={att.id} className="m-chip">
          {preview ? <img src={preview} alt="" /> : <AttachmentIcon a={att} size={18} />}
          <span>
            <strong>{att.name}</strong>
            <small>
              {typeLabel(att)} · {fmtSize(att.size)}
            </small>
          </span>
          <button type="button" aria-label={'Remover ' + att.name} disabled={disabled} onClick={() => onRemove(att.id)}>
            <X size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
// Small preview for the chip (a data: URL, which the page's CSP allows); big images just show an icon.
export const previewOf = (file) =>
  file.type.startsWith('image/') && file.size < 3 * 1048576
    ? new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => resolve('');
        r.readAsDataURL(file);
      })
    : Promise.resolve('');
