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
  Sparkles,
} from 'lucide-react';
// Kind of a consolidated page from its path (sessions/, _rules/, gotchas/, concepts/...).
const insightLabel = (path = '') =>
  path.startsWith('_rules/')
    ? 'REGRA'
    : path.startsWith('gotchas/')
      ? 'ARMADILHA'
      : path.startsWith('decisions/')
        ? 'DECISÃO'
        : 'APRENDIZADO';
import { action } from '../lib/api';
import { IconButton } from './IconButton';
import { formatDate } from '../lib/format';
import { Chapter } from './Chapter';
import { ProfileList } from './ProfileList';
import { useEffect, useState } from 'react';
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
  // Preferences the AIs learned live in the AI Memory profile, not in the app catalogue: count them too.
  const [learned, setLearned] = useState(0);
  useEffect(() => {
    if (!memoryStatus?.connected) return;
    let alive = true;
    call('profileList')
      .then((entries) => alive && setLearned(entries?.length || 0))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `call` is not memoized; refetch only when these change
  }, [memoryStatus?.connected, memoryFilter]);
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <Chapter n={4} title="MEMÓRIA" />
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
            <strong>{data.memories.filter((m) => m.kind === 'preference').length + learned}</strong>
            <span>preferências pessoais</span>
          </div>
        </div>
        <div>
          <span className="summary-icon">
            <HardDrive size={23} />
          </span>
          <div>
            <strong className="summary-status">{memoryStatus?.connected ? 'Conectado' : 'Verificar conexão'}</strong>
            <span>
              {memoryStatus?.consolidation?.provider === 'codex'
                ? 'AI Memory · consolida com Codex' +
                  (memoryStatus.consolidation.open
                    ? ' · ' + memoryStatus.consolidation.open + ' sessão(ões) aberta(s)'
                    : '')
                : 'AI Memory · local · sem IA'}
            </span>
          </div>
        </div>
      </div>
      <div className="memory-toolbar">
        <div className="tabs">
          {[
            ['all', 'Tudo'],
            ['preferences', 'Preferências'],
            ['insights', 'Regras e decisões'],
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
      {/* Preferências: what the AIs learned (and you edited) in the AI Memory profile, then the ones written here. */}
      {memoryFilter === 'preferences' && (
        <>
          <h2 className="memory-subheading">Aprendidas pelas IAs</h2>
          <ProfileList call={call} connected={memoryStatus?.connected} />
          <h2 className="memory-subheading">Escritas por você</h2>
        </>
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
                ) : m.kind === 'insight' ? (
                  <Sparkles size={13} />
                ) : (
                  <FileText size={13} />
                )}{' '}
                {m.kind === 'preference'
                  ? 'PREFERÊNCIA PESSOAL'
                  : m.kind === 'session'
                    ? 'CONVERSA'
                    : m.kind === 'insight'
                      ? insightLabel(m.path)
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
