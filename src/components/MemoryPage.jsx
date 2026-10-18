import {
  ArrowUpRight,
  Plus,
  Search,
  MessageSquare,
  Brain,
  X,
  ShieldCheck,
  FileText,
  Globe,
  HardDrive,
} from 'lucide-react';
import { action } from '../lib/api';
import { IconButton } from './IconButton';
import { formatDate } from '../lib/format';
export function MemoryPage({
  newMemory,
  data,
  memoryStatus,
  memoryFilter,
  setMemoryFilter,
  memorySearch,
  setMemorySearch,
  setQueryResult,
  call,
  projectId,
  queryResult,
  shownMemories,
  setModal,
}) {
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONTEXTO QUE CONTINUA</div>
          <h1>Vale a pena lembrar.</h1>
          <p>Uma memória compartilhada entre suas inteligências.</p>
        </div>
        <button className="primary-button" onClick={newMemory}>
          <Plus size={16} />
          Nova memória
        </button>
      </div>
      <div className="memory-summary">
        <div>
          <span className="summary-icon">
            <Brain size={23} />
          </span>
          <div>
            <strong>{data.memories.length}</strong>
            <span>memórias guardadas</span>
          </div>
        </div>
        <div>
          <span className="summary-icon">
            <Globe size={23} />
          </span>
          <div>
            <strong>{data.memories.filter((m) => m.kind === 'preference').length}</strong>
            <span>preferências pessoais</span>
          </div>
        </div>
        <div>
          <span className="summary-icon">
            <HardDrive size={23} />
          </span>
          <div>
            <strong className="summary-status">{memoryStatus?.connected ? 'Conectado' : 'Verificar conexão'}</strong>
            <span>AI Memory · local · sem API</span>
          </div>
        </div>
      </div>
      <div className="memory-toolbar">
        <div className="tabs">
          {[
            ['all', 'Tudo'],
            ['preferences', 'Preferências'],
            ['notes', 'Notas'],
            ['sessions', 'Conversas'],
          ].map(([id, label]) => (
            <button className={memoryFilter === id ? 'selected' : ''} onClick={() => setMemoryFilter(id)} key={id}>
              {label}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={15} />
          <input
            placeholder="Buscar na memória"
            value={memorySearch}
            onChange={(e) => setMemorySearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && memorySearch.trim())
                action(async () => {
                  setQueryResult(await call('searchMemory', { query: memorySearch, projectId: projectId || null }));
                })();
            }}
          />
          {memorySearch && (
            <button
              title="Buscar no AI Memory"
              onClick={action(async () =>
                setQueryResult(await call('searchMemory', { query: memorySearch, projectId: projectId || null }))
              )}
            >
              <ArrowUpRight size={14} />
            </button>
          )}
        </label>
      </div>
      {queryResult !== null && (
        <div className="query-result">
          <div className="row spread">
            <strong>Busca no índice do AI Memory</strong>
            <IconButton icon={X} label="Fechar resultados" onClick={() => setQueryResult(null)} />
          </div>
          <pre>{queryResult}</pre>
        </div>
      )}
      <div className="memory-grid">
        {shownMemories.map((m) => (
          <button className="memory-card" key={m.id} onClick={() => setModal({ ...m, type: 'memory' })}>
            <div className="memory-card-label">
              <span>
                {m.kind === 'preference' ? (
                  <Globe size={13} />
                ) : m.kind === 'session' ? (
                  <MessageSquare size={13} />
                ) : (
                  <FileText size={13} />
                )}{' '}
                {m.kind === 'preference'
                  ? 'PREFERÊNCIA PESSOAL'
                  : m.kind === 'session'
                    ? 'CONVERSA'
                    : 'NOTA DE PROJETO'}
              </span>
              <ArrowUpRight size={15} />
            </div>
            <h3>{m.title}</h3>
            <p>{m.body.replace(/[#*`]/g, '').slice(0, 200)}</p>
            <div className="memory-card-footer">
              <span>
                {m.kind === 'preference'
                  ? 'Todas as IAs · todos os projetos'
                  : data.projects.find((p) => p.id === m.projectId)?.name || 'Espaço pessoal'}
              </span>
              <span>{formatDate(m.updatedAt || m.createdAt)}</span>
            </div>
          </button>
        ))}
      </div>
      {!shownMemories.length && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Brain size={34} />
          </div>
          <h2>O começo de uma boa memória.</h2>
          <p>
            Guarde como prefere trabalhar, decisões de projeto
            <br />e detalhes que suas IAs devem levar adiante.
          </p>
          <button className="secondary-button" onClick={newMemory}>
            <Plus size={15} />
            Guardar a primeira memória
          </button>
        </div>
      )}
      <div className="memory-explanation">
        <ShieldCheck size={17} />
        <p>
          Preferências valem para todos os projetos. Notas e trechos de conversas ficam no seu espaço de origem. As
          conversas usam apenas o contexto relevante e as preferências pessoais.
        </p>
      </div>
    </div>
  );
}
