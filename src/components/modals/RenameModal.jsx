import { action } from '../../lib/api';
export function RenameModal({ modal, setModal, setData, call }) {
  return (
    <>
      <input
        aria-label="Nome da conversa"
        value={modal.title}
        onChange={(e) => setModal({ ...modal, title: e.target.value })}
        autoFocus
      />
      <div className="modal-footer">
        <button
          className="primary-button"
          onClick={action(async () => {
            setData(await call('renameChat', modal));
            setModal(null);
          })}
        >
          Salvar
        </button>
      </div>
    </>
  );
}
