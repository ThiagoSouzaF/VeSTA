import { PROVIDERS } from '../../lib/constants';
import { ProviderIcon } from '../ProviderIcon';
import { ArrowUpRight, Plus, Check, Pencil, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { action } from '../../lib/api';
export function NewChatModal({ modal, setModal, data, addProject, integrations, createChat }) {
  return (
    <>
      <label className="field-label">INTELIGÊNCIA</label>
      <div className="modal-providers">
        {Object.entries(PROVIDERS).map(([id, p]) => (
          <button
            className={modal.provider === id ? 'selected' : ''}
            key={id}
            onClick={() =>
              setModal({
                ...modal,
                provider: id,
                mode: id === 'drael' && modal.mode === 'ask' ? 'read' : modal.mode,
                model: id === 'opencode' ? 'drael/drael-v1' : '',
              })
            }
          >
            <ProviderIcon id={id} small />
            {p.name}
            {modal.provider === id && <Check size={13} />}
          </button>
        ))}
      </div>
      <label className="field-label" htmlFor="new-project">
        PROJETO
      </label>
      <div className="row">
        <select
          id="new-project"
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
        <button className="secondary-button" onClick={action(addProject)}>
          <Plus size={15} />
          Pasta
        </button>
      </div>
      <label className="field-label" htmlFor="model">
        MODELO
      </label>
      <input
        id="model"
        disabled={modal.provider === 'drael'}
        value={modal.model}
        onChange={(e) => setModal({ ...modal, model: e.target.value })}
        placeholder="Padrão da sua conta"
        list="models"
      />
      <datalist id="models">
        {(modal.provider === 'opencode' ? integrations.opencode?.models || [] : []).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <p className="field-help">Deixe vazio para usar o modelo configurado no programa.</p>
      <label className="field-label">COMO A IA PODE TRABALHAR?</label>
      <div className="mode-options">
        <button
          className={modal.mode === 'read' ? 'selected' : ''}
          onClick={() => setModal({ ...modal, mode: 'read' })}
        >
          <ShieldCheck size={18} />
          <strong>Consultar</strong>
          <span>Ler, analisar e planejar.</span>
        </button>
        <button
          disabled={modal.provider === 'drael'}
          className={modal.mode === 'ask' ? 'selected' : ''}
          onClick={() => setModal({ ...modal, mode: 'ask' })}
        >
          <ShieldQuestion size={18} />
          <strong>Pedir permissão</strong>
          <span>Você aprova comandos e edições.</span>
        </button>
        <button
          className={modal.mode === 'edit' ? 'selected' : ''}
          onClick={() => setModal({ ...modal, mode: 'edit' })}
        >
          <Pencil size={18} />
          <strong>Acesso completo</strong>
          <span>Editar e rodar sem perguntar.</span>
        </button>
      </div>
      {modal.provider === 'drael' && (
        <p className="field-help">
          O harness nativo usa drael-v1. O histórico fica no VeSTA; o terminal abre uma conversa própria. Aprovações
          interativas ficam disponíveis no terminal.
        </p>
      )}
      {modal.mode === 'ask' && (
        <p className="field-help">
          Quando a IA ou um subagente precisar editar um arquivo ou rodar um comando, o pedido aparece na conversa para
          você permitir, permitir sempre nesta conversa ou negar.
        </p>
      )}
      <div className="modal-footer">
        <button className="secondary-button" onClick={() => setModal(null)}>
          Cancelar
        </button>
        <button
          className="primary-button"
          onClick={action(() => createChat({ ...modal, projectId: modal.projectId || null }))}
        >
          Criar chat
          <ArrowUpRight size={15} />
        </button>
      </div>
    </>
  );
}
