import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { attachmentUrl, fmtSize, imagesOf, typeLabel } from '../lib/attachments';
import { AttachmentIcon } from './AttachmentIcon';
import { action } from '../lib/api';
// Attachments of a sent message: image thumbnails (click opens the viewer) and document cards (open in the default program).
export function MessageAttachments({ chatId, attachments, call }) {
  const [view, setView] = useState(null);
  if (!attachments?.length) return null;
  const images = imagesOf(attachments);
  return (
    <>
      <div className="message-attachments">
        {attachments.map((a) =>
          a.kind === 'image' ? (
            <button
              key={a.id}
              type="button"
              className="attachment-thumb"
              aria-label={'Abrir imagem ' + a.name}
              title={a.name}
              onClick={() => setView(images.findIndex((x) => x.id === a.id))}
            >
              <img src={attachmentUrl(chatId, a, true)} alt={a.name} loading="lazy" decoding="async" />
            </button>
          ) : (
            <button
              key={a.id}
              type="button"
              className="attachment-card"
              title={'Abrir ' + a.name}
              onClick={action(() => call('openAttachment', { chatId, id: a.id }))}
            >
              <AttachmentIcon a={a} size={20} />
              <span className="attachment-meta">
                <strong>{a.name}</strong>
                <small>
                  {typeLabel(a)} · {fmtSize(a.size)}
                </small>
              </span>
            </button>
          )
        )}
      </div>
      {view !== null && images[view] && <ImageViewer chatId={chatId} images={images} index={view} setIndex={setView} />}
    </>
  );
}
// Full-screen viewer inside the app: Esc closes, arrows move between the images of the message.
function ImageViewer({ chatId, images, index, setIndex }) {
  const a = images[index];
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIndex(null);
      } else if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < images.length - 1) setIndex(index + 1);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [index, images.length, setIndex]);
  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={'Imagem ' + a.name}
      onClick={() => setIndex(null)}
    >
      <button type="button" className="viewer-close" aria-label="Fechar visualizador" onClick={() => setIndex(null)}>
        <X size={20} />
      </button>
      {index > 0 && (
        <button
          type="button"
          className="viewer-nav prev"
          aria-label="Imagem anterior"
          onClick={(e) => (e.stopPropagation(), setIndex(index - 1))}
        >
          <ChevronLeft size={24} />
        </button>
      )}
      <img src={attachmentUrl(chatId, a)} alt={a.name} onClick={(e) => e.stopPropagation()} />
      {index < images.length - 1 && (
        <button
          type="button"
          className="viewer-nav next"
          aria-label="Próxima imagem"
          onClick={(e) => (e.stopPropagation(), setIndex(index + 1))}
        >
          <ChevronRight size={24} />
        </button>
      )}
      <div className="viewer-caption">
        {a.name} · {fmtSize(a.size)}
        {images.length > 1 ? ' · ' + (index + 1) + '/' + images.length : ''}
      </div>
    </div>
  );
}
