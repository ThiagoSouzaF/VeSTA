import { Mark, Wordmark } from './Brand';
import { MascotAvatar, useMascot } from './Mascot';
import { STATE_LABEL } from '../lib/mascot';
import {
  ArrowUpRight,
  Plus,
  Search,
  MessageSquare,
  Brain,
  Layers,
  Settings,
  Folder,
  ChevronRight,
  Globe,
  HardDrive,
  BarChart3,
  ShieldAlert,
  Activity,
  Swords,
} from 'lucide-react';
import { IconButton } from './IconButton';
import { action } from '../lib/api';
import { ProviderIcon } from './ProviderIcon';
import { PROVIDERS } from '../lib/constants';
import { formatDate } from '../lib/format';
export function Sidebar({
  openNew,
  page,
  setPage,
  data,
  addProject,
  projectId,
  setProjectId,
  setActive,
  filteredChats,
  search,
  setSearch,
  active,
  goChat,
  taskCounts,
  questsRunning = 0,
}) {
  const mascot = useMascot();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Mark size={34} />
        </div>
        <div>
          <strong>
            <Wordmark />
            <span className="beta">BETA</span>
          </strong>
          <span>O centro do seu lar digital.</span>
        </div>
      </div>
      {mascot.enabled && (
        <div className="brand-mascot">
          <MascotAvatar onOpen={() => setPage('activity')} />
          <div>
            <strong>{STATE_LABEL[mascot.state]}</strong>
            <span>{mascot.phrase}</span>
          </div>
        </div>
      )}
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
      <div className="sidebar-section">
        <span>PROJETOS</span>
        <IconButton icon={Plus} label="Adicionar projeto" onClick={action(addProject)} />
      </div>
      <button
        className={'project-item ' + (!projectId ? 'selected' : '')}
        onClick={() => {
          setProjectId('');
          setActive(null);
        }}
      >
        <Globe size={15} />
        Todos os projetos<span>{data.projects.length}</span>
      </button>
      {data.projects.map((p) => (
        <button
          className={'project-item ' + (projectId === p.id ? 'selected' : '')}
          title={p.path}
          key={p.id}
          onClick={() => {
            setProjectId(p.id);
            setActive(null);
            setPage('chat');
          }}
        >
          <Folder size={15} />
          <span className="truncate">{p.name}</span>
          <ChevronRight size={13} />
        </button>
      ))}
      {!data.projects.length && (
        <button className="add-project-empty" onClick={action(addProject)}>
          Conecte uma pasta para começar
          <ArrowUpRight size={14} />
        </button>
      )}
      <div className="sidebar-section conversation-heading">
        <span>CONVERSAS</span>
        <span className="muted">{filteredChats.length.toString().padStart(2, '0')}</span>
      </div>
      <label className="search-field">
        <Search size={14} />
        <input
          id="search-chats"
          placeholder="Buscar conversas"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <kbd>⌃ K</kbd>
      </label>
      <div className="chat-list">
        {filteredChats.map((c) => (
          <button
            key={c.id}
            className={'chat-list-item ' + (active === c.id && page === 'chat' ? 'selected' : '')}
            onClick={() => goChat(c)}
          >
            <ProviderIcon id={c.provider} small />
            <div>
              <span>{c.title}</span>
              <small>
                {PROVIDERS[c.provider].name} · {formatDate(c.updatedAt)}
              </small>
            </div>
            {c.messages.some((m) => m.permissions?.some((x) => x.status === 'pending')) ? (
              <span className="permission-dot" title="Aguardando sua permissão">
                <ShieldAlert size={12} />
              </span>
            ) : taskCounts.byChat[c.id] ? (
              <span
                className="task-badge"
                title={
                  taskCounts.byChat[c.id] + (taskCounts.byChat[c.id] === 1 ? ' tarefa rodando' : ' tarefas rodando')
                }
              >
                {taskCounts.byChat[c.id]}
              </span>
            ) : (
              (data.running.includes(c.id) && <span className="pulse-dot" />) ||
              (data.following?.some((f) => f.chatId === c.id) && (
                <span className="follow-dot" title="Acompanhando processos em segundo plano" />
              ))
            )}
          </button>
        ))}
        {!filteredChats.length && (
          <div className="empty-chats">
            <MessageSquare size={20} />
            <span>{search ? 'Nenhuma conversa encontrada' : 'As boas ideias começam\ncom uma conversa.'}</span>
          </div>
        )}
      </div>
      <div className="sidebar-bottom">
        <button className={'nav-item ' + (page === 'settings' ? 'active' : '')} onClick={() => setPage('settings')}>
          <Settings size={17} />
          Preferências
        </button>
        <div className="local-status">
          <span className="status-dot" />
          <div>
            <strong>Feito para o seu computador</strong>
            <span>Conversas salvas localmente</span>
          </div>
          <HardDrive size={15} />
        </div>
      </div>
    </aside>
  );
}
