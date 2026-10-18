import { action } from '../../lib/api';
import { Trash2 } from 'lucide-react';
export function DeleteModal({ modal, setModal, busy, setBusy, setData, call, setActive }) {
  return (
    <>
      <p className="delete-description">
        {modal.type === 'delete-memory'
          ? 'Esta memória será removida do AI Memory e deixará de ser consultada.'
          : 'A conversa será removida do VeSTA. As memórias guardadas e a sessão nativa da IA serão preservadas.'}
      </p>
      <div className="modal-footer">
        <button className="secondary-button" onClick={() => setModal(null)}>
          Cancelar
        </button>
        <button
          className="danger-button filled"
          disabled={busy}
          onClick={action(async () => {
            setBusy(true);
            try {
              setData(await call(modal.type === 'delete-memory' ? 'deleteMemory' : 'deleteChat', { id: modal.id }));
              if (modal.type === 'delete-chat') setActive(null);
              setModal(null);
            } finally {
              setBusy(false);
            }
          })}
        >
          <Trash2 size={15} />
          Excluir
        </button>
      </div>
    </>
  );
}
