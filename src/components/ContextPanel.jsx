import { ArrowUpRight, Plus, Brain, Folder, Check, ShieldCheck, Orbit, ExternalLink, FileText } from 'lucide-react';
import { action } from '../lib/api';
import { Mark } from './Brand';
export function ContextPanel({
  chat,
  currentProject,
  projectId,
  setProjectId,
  data,
  addProject,
  call,
  memoryStatus,
  currentProjectId,
  setPage,
  instructions,
}) {
  return (
    <aside className="context-panel">
      <div className="context-title">
        <Orbit size={15} />
        <span>CONTEXTO DO CHAT</span>
      </div>
      <div className="context-section">
        <div className="context-label">PROJETO</div>
        {chat ? (
          <div className="context-project">
            <Folder size={17} />
            <div>
              <strong>{currentProject?.name || 'Espaço pessoal'}</strong>
              <span>{currentProject ? 'Pasta conectada' : 'Uma conversa sem projeto'}</span>
            </div>
          </div>
        ) : (
          <>
            <select
              aria-label="Projeto da próxima conversa"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Espaço pessoal</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="text-button" onClick={action(addProject)}>
              <Plus size={13} />
              Conectar uma pasta
            </button>
          </>
        )}
        {currentProject && (
          <button
            className="context-path"
            title={currentProject.path}
            onClick={action(() => call('openProject', { id: currentProject.id }))}
          >
            <span>{currentProject.path}</span>
            <ExternalLink size={12} />
          </button>
        )}
      </div>
      <div className="context-section">
        <div className="context-label">
          MEMÓRIA COMPARTILHADA <span className={'status-dot ' + (memoryStatus?.connected ? '' : 'offline')} />
        </div>
        <div className="memory-visual">
          <Brain size={24} />
          <div>
            <strong>Uma memória. Todas as IAs.</strong>
            <span>Conectada ao AI Memory</span>
          </div>
        </div>
        <p>O que você guarda aqui acompanha suas conversas, mesmo quando troca de IA.</p>
        <div className="context-stat">
          <span>Preferências pessoais</span>
          <strong>
            {data.memories
              .filter((m) => m.kind === 'preference')
              .length.toString()
              .padStart(2, '0')}
          </strong>
        </div>
        <div className="context-stat">
          <span>Memórias deste espaço</span>
          <strong>
            {data.memories
              .filter((m) => m.projectId === (currentProjectId || null))
              .length.toString()
              .padStart(2, '0')}
          </strong>
        </div>
        <button className="text-button" onClick={() => setPage('memory')}>
          Explorar memória
          <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="context-section">
        <div className="context-label">
          INSTRUÇÕES DO PROJETO <ShieldCheck size={13} />
        </div>
        {instructions.length ? (
          instructions.map((f) => (
            <button
              className="instruction"
              key={f.path}
              title={f.path}
              onClick={action(() => call('openInstructions', { projectId: currentProjectId, file: f.path }))}
            >
              <FileText size={14} />
              <span>{f.name}</span>
              <Check size={12} />
            </button>
          ))
        ) : (
          <div className="instruction-placeholder">
            <FileText size={19} />
            <p>
              {currentProject
                ? 'Nenhum arquivo de instruções detectado na pasta e seus diretórios pais.'
                : 'Conecte um projeto para ver suas instruções.'}
            </p>
          </div>
        )}
        <p className="fine-print">
          Cada IA carrega suas próprias instruções. Seus arquivos permanecem sob seu controle.
        </p>
      </div>
      <div className="context-bottom">
        <div className="small-mark">
          <Mark size={23} />
        </div>
        <p>
          Seu contexto tem um centro.
          <br />
          <strong>Você.</strong>
        </p>
      </div>
    </aside>
  );
}
