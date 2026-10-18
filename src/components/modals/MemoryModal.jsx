import { Check, Trash2, LoaderCircle } from 'lucide-react';
import { action } from '../../lib/api';
export function MemoryModal({ modal, setModal, data, busy, setBusy, setData, call, notify }) {
  return (
    <>
      <label className="field-label" htmlFor="memory-title">
        TÍTULO
      </label>
      <input
        id="memory-title"
        placeholder="Ex.: Como gosto de organizar meus projetos"
        value={modal.title}
        onChange={(e) => setModal({ ...modal, title: e.target.value })}
      />
      {!modal.id && (
        <>
          <label className="field-label" htmlFor="memory-kind">
            ONDE ESSA MEMÓRIA VALE?
          </label>
          <select id="memory-kind" value={modal.kind} onChange={(e) => setModal({ ...modal, kind: e.target.value })}>
            <option value="preference">Preferência pessoal · todos os projetos</option>
            <option value="note">Nota · apenas este projeto ou espaço</option>
          </select>
          {modal.kind === 'note' && (
            <select
              aria-label="Projeto da memória"
              value={modal.projectId}
              onChange={(e) => setModal({ ...modal, projectId: e.target.value })}
            >
              <option value="">Espaço pessoal</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      <label className="field-label" htmlFor="memory-body">
        CONTEÚDO
      </label>
      <textarea
        id="memory-body"
        rows={8}
        placeholder="Prefiro respostas em português, planos claros e arquivos organizados por projeto…"
        value={modal.body}
        onChange={(e) => setModal({ ...modal, body: e.target.value })}
      />
      <p className="field-help">Salvo no AI Memory local. Você pode editar ou excluir quando quiser.</p>
      <div className="modal-footer">
        {modal.id && (
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => setModal({ ...modal, type: 'delete-memory' })}
          >
            <Trash2 size={14} />
            Excluir
          </button>
        )}
        <button className="secondary-button" onClick={() => setModal(null)}>
          Cancelar
        </button>
        <button
          className="primary-button"
          disabled={busy || !modal.title.trim() || !modal.body.trim()}
          onClick={action(async () => {
            setBusy(true);
            try {
              setData(await call('saveMemory', modal));
              setModal(null);
              notify('Memória guardada no AI Memory');
            } finally {
              setBusy(false);
            }
          })}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Guardar memória
        </button>
      </div>
    </>
  );
}
