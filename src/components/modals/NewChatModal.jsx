import { PROVIDERS, MODEL_LABELS } from '../../lib/constants';
import { ProviderIcon } from '../ProviderIcon';
import { ArrowUpRight, Plus, Check, Pencil, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { action } from '../../lib/api';
const OTHER = '__other__';
export function NewChatModal({ modal, setModal, data, addProject, integrations, createChat }) {
  // The models offered follow the chosen AI (Claude aliases, the Codex cache, `opencode models`).
  const models = integrations[modal.provider]?.models || [];
  const custom = modal.customModel || (!!modal.model && !models.includes(modal.model));
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
                customModel: false,
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
      <select
        id="model"
        disabled={modal.provider === 'drael'}
        value={custom ? OTHER : modal.model}
        onChange={(e) =>
          setModal({
            ...modal,
            model: e.target.value === OTHER ? '' : e.target.value,
            customModel: e.target.value === OTHER,
          })
        }
      >
        <option value="">Padrão da sua conta</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {MODEL_LABELS[m] ? MODEL_LABELS[m] + ' · ' + m : m}
          </option>
        ))}
        <option value={OTHER}>Outro modelo…</option>
      </select>
      {custom && (
        <input
          id="model-custom"
          aria-label="Id do modelo"
          autoFocus
          value={modal.model}
          onChange={(e) => setModal({ ...modal, model: e.target.value })}
          placeholder="Id do modelo, como aparece no programa"
        />
      )}
      <p className="field-help">
        {models.length
          ? 'Modelos que o ' + PROVIDERS[modal.provider].name + ' oferece. O padrão usa o configurado no programa.'
          : 'Não encontrei a lista de modelos desta IA; use o padrão ou informe o id em Outro modelo.'}
      </p>
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
          onClick={action(() => {
            const { customModel, ...options } = modal;
            return createChat({ ...options, model: options.model.trim(), projectId: options.projectId || null });
          })}
        >
          Criar chat
          <ArrowUpRight size={15} />
        </button>
      </div>
    </>
  );
}
