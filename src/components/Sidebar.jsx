import { Mark, Wordmark } from './Brand';
import { MascotAvatar, useMascot } from './Mascot';
import { STATE_LABEL } from '../lib/mascot';
import { Plus, MessageSquare, Brain, Layers, Settings, BarChart3, Activity, Swords } from 'lucide-react';
import { ConversationTree } from './ConversationTree';
import { action } from '../lib/api';
export function Sidebar({
  openNew,
  page,
  setPage,
  data,
  addProject,
  projectId,
  setProjectId,
  filteredChats,
  search,
  setSearch,
  active,
  goChat,
  moveChat,
  taskCounts,
  questsRunning = 0,
}) {
  const mascot = useMascot();
  return (
    <aside className="sidebar">
      {/* The mascot is the logo: her face shows what the AIs are doing, the line below says it (click: Atividade). */}
      <div className="brand">
        {mascot.enabled ? (
          <MascotAvatar onOpen={() => setPage('activity')} />
        ) : (
          <div className="brand-mark">
            <Mark size={34} />
          </div>
        )}
        <div className="brand-text">
          <strong>
            <Wordmark />
            <span className="beta">BETA</span>
          </strong>
          {mascot.enabled ? (
            <button
              className="brand-status"
              data-testid="brand-status"
              onClick={() => setPage('activity')}
              title={mascot.phrase}
            >
              <b>{STATE_LABEL[mascot.state]}</b> {mascot.phrase}
            </button>
          ) : (
            <span>O centro do seu lar digital.</span>
          )}
        </div>
      </div>
      <button className="new-chat" onClick={openNew}>
        <Plus size={18} /> Novo chat <kbd>Ctrl N</kbd>
      </button>
      <nav>
        {[
          { id: 'chat', name: 'Conversas', icon: MessageSquare },
          { id: 'activity', name: 'Atividade', icon: Activity },
          { id: 'quests', name: 'Quests', icon: Swords },
          { id: 'memory', name: 'Memória', icon: Brain },
          { id: 'usage', name: 'Uso', icon: BarChart3 },
          { id: 'connections', name: 'Conexões', icon: Layers },
        ].map((n) => (
          <button className={page === n.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(n.id)} key={n.id}>
            <n.icon size={18} />
            {n.name}
            {n.id === 'memory' && data.memories.length > 0 && <span className="count">{data.memories.length}</span>}
            {n.id === 'quests' && questsRunning > 0 && (
              <span className="count live" title="Quests rodando agora">
                {questsRunning}
              </span>
            )}
            {n.id === 'activity' && taskCounts.total > 0 && (
              <span className="count live" title="Tarefas rodando agora">
                {taskCounts.total}
              </span>
            )}
          </button>
        ))}
      </nav>
      <ConversationTree
        data={data}
        chats={filteredChats}
        search={search}
        setSearch={setSearch}
        active={active}
        page={page}
        goChat={goChat}
        projectId={projectId}
        setProjectId={setProjectId}
        openNew={openNew}
        addProject={action(addProject)}
        moveChat={moveChat}
        taskCounts={taskCounts}
      />
      <div className="sidebar-bottom">
        <button className={'nav-item ' + (page === 'settings' ? 'active' : '')} onClick={() => setPage('settings')}>
          <Settings size={17} />
          Preferências
        </button>
      </div>
    </aside>
  );
}
