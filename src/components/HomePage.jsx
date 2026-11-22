import { useMemo, useState } from 'react';
import { FolderPlus, LoaderCircle, Search, Zap } from 'lucide-react';
import { Chapter } from './Chapter';
import { action } from '../lib/api';
import { formatDate } from '../lib/format';
import { filterChats } from '../lib/filters';
import { TabInk } from './TabInk';

const SORTS = [
  { id: 'recent', label: 'Recentes' },
  { id: 'running', label: 'Com tarefas rodando' },
  { id: 'name', label: 'A–Z' },
];

// One tile per project plus the Espaço pessoal: how many chats, when it was last used and what is running now.
export function projectTiles(data, taskCounts) {
  const chats = filterChats(data.chats, data.quests, { projectId: '', search: '' }, data.agents);
  const tile = (id, name, path, project) => {
    const own = chats.filter((c) => (c.projectId || '') === id);
    return {
      id,
      name,
      path,
      project,
      chats: own.length,
      lastAt: own.reduce((x, c) => Math.max(x, c.updatedAt || 0), 0),
      // A chat answering counts once even before it launches anything.
      running: own.reduce((x, c) => x + Math.max(taskCounts.byChat[c.id] || 0, data.running.includes(c.id) ? 1 : 0), 0),
    };
  };
  return [
    ...data.projects.map((p) => tile(p.id, p.name, p.path, true)),
    tile('', 'Espaço pessoal', 'Conversas sem pasta', false),
  ];
}

// Início: pick the project to work on. Quick questions without a project go to the Espaço pessoal.
export function HomePage({ data, taskCounts, onOpenProject, addProject, onQuickAsk, busy }) {
  const [sort, setSort] = useState('recent'),
    [search, setSearch] = useState(''),
    [quick, setQuick] = useState('');
  const tiles = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = projectTiles(data, taskCounts).filter(
      (t) => !needle || (t.name + ' ' + t.path).toLowerCase().includes(needle)
    );
    if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (sort === 'running') return list.filter((t) => t.running).sort((a, b) => b.running - a.running);
    return list.sort((a, b) => b.lastAt - a.lastAt);
  }, [data, taskCounts, sort, search]);
  const ask = () => {
    if (!quick.trim() || busy) return;
    onQuickAsk(quick);
    setQuick('');
  };
  return (
    <div className="content-page home-page">
      <div className="home-inner">
        <div className="page-heading">
          <div>
            <Chapter n={0} title="INÍCIO" />
            <div className="eyebrow">INÍCIO</div>
            <h1>Em que vamos trabalhar hoje?</h1>
            <p>Escolha um projeto para abrir as conversas dele.</p>
          </div>
        </div>
        <div className="home-toolbar">
          <div className="home-sorts tab-ink-host" role="group" aria-label="Ordenar projetos">
            {SORTS.map((s) => (
              <button key={s.id} className={sort === s.id ? 'active' : ''} onClick={() => setSort(s.id)}>
                {s.label}
              </button>
            ))}
            <TabInk active=".active" value={sort} box />
          </div>
          <label className="search-field">
            <Search size={14} />
            <input placeholder="Buscar projeto" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        <div className="project-grid">
          {tiles.map((t) => (
            <button
              key={t.id || 'personal'}
              className={'project-tile' + (t.project ? '' : ' personal')}
              data-project={t.id || 'personal'}
              onClick={() => onOpenProject(t.id)}
              title={t.path}
            >
              {t.running > 0 && (
                <span className="project-running">
                  <LoaderCircle size={10} className="spin" />
                  {t.running} rodando
                </span>
              )}
              <span className="project-monogram" aria-hidden="true">
                {t.project ? t.name.trim().charAt(0).toUpperCase() : '~'}
              </span>
              <strong>{t.name}</strong>
              <span className="project-path">{t.path}</span>
              <span className="project-meta">
                <span>
                  {t.chats} {t.chats === 1 ? 'conversa' : 'conversas'}
                </span>
                <span>{t.lastAt ? formatDate(t.lastAt) : 'nova'}</span>
              </span>
            </button>
          ))}
          {sort !== 'running' && !search && (
            <button className="project-tile add" onClick={action(addProject)}>
              <FolderPlus size={26} />
              <strong>Conectar uma pasta</strong>
            </button>
          )}
          {!tiles.length && <p className="home-empty">Nenhum projeto aqui.</p>}
        </div>
        <label className="home-quick">
          <Zap size={15} />
          <input
            placeholder="Ou pergunte algo rápido, sem projeto…"
            aria-label="Pergunta rápida"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask())}
          />
          <small>vai para o Espaço pessoal</small>
        </label>
      </div>
    </div>
  );
}
