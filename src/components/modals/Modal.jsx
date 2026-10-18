import { IconButton } from '../IconButton';
import { X } from 'lucide-react';
import { NewChatModal } from './NewChatModal';
import { MemoryModal } from './MemoryModal';
import { RenameModal } from './RenameModal';
import { DeleteModal } from './DeleteModal';
export function Modal({
  setModal,
  modal,
  data,
  addProject,
  integrations,
  createChat,
  busy,
  setBusy,
  setData,
  call,
  notify,
  setActive,
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setModal(null);
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">
              {modal.type === 'new'
                ? 'UM NOVO PONTO DE PARTIDA'
                : modal.type === 'memory'
                  ? 'CONTEXTO QUE CONTINUA'
                  : 'CONVERSA'}
            </span>
            <h2>
              {modal.type === 'new'
                ? 'Vamos conversar.'
                : modal.type === 'memory'
                  ? modal.id
                    ? 'Sua memória'
                    : 'O que vale lembrar?'
                  : modal.type === 'rename'
                    ? 'Renomear conversa'
                    : 'Excluir conversa?'}
            </h2>
          </div>
          <IconButton icon={X} label="Fechar diálogo" onClick={() => setModal(null)} />
        </div>
        {modal.type === 'new' ? (
          <NewChatModal
            modal={modal}
            setModal={setModal}
            data={data}
            addProject={addProject}
            integrations={integrations}
            createChat={createChat}
          />
        ) : modal.type === 'memory' ? (
          <MemoryModal
            modal={modal}
            setModal={setModal}
            data={data}
            busy={busy}
            setBusy={setBusy}
            setData={setData}
            call={call}
            notify={notify}
          />
        ) : modal.type === 'rename' ? (
          <RenameModal modal={modal} setModal={setModal} setData={setData} call={call} />
        ) : (
          <DeleteModal
            modal={modal}
            setModal={setModal}
            busy={busy}
            setBusy={setBusy}
            setData={setData}
            call={call}
            setActive={setActive}
          />
        )}
      </div>
    </div>
  );
}
