import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderPlus,
  Home,
  MessageSquare,
  Plus,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { IconButton } from './IconButton';
import { ProviderIcon } from './ProviderIcon';
import { PROVIDERS } from '../lib/constants';
import { formatDate } from '../lib/format';
import { groupChats, PERSONAL } from '../lib/filters';

const DRAG_TYPE = 'application/x-vesta-chat';
const STORE_KEY = 'vesta.sidebar.collapsed';
// Which groups are collapsed is a per-window convenience: kept in localStorage, never required.
const loadCollapsed = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'));
  } catch {
    return new Set();
  }
};
const saveCollapsed = (set) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...set]));
  } catch {}
};

function ChatItem({ c, selected, onOpen, data, taskCounts }) {
  const tasks = taskCounts.byChat[c.id];
  return (
    <button
      className={'chat-list-item ' + (selected ? 'selected' : '')}
      data-chat={c.id}
      onClick={onOpen}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, c.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      title="Arraste para outro projeto para mover a conversa"
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
      ) : tasks ? (
        <span className="task-badge" title={tasks + (tasks === 1 ? ' tarefa rodando' : ' tarefas rodando')}>
          {tasks}
        </span>
      ) : (
        (data.running.includes(c.id) && <span className="pulse-dot" />) ||
        (data.following?.some((f) => f.chatId === c.id) && (
          <span className="follow-dot" title="Acompanhando processos em segundo plano" />
        ))
      )}
    </button>
  );
}

// Conversas, grouped by project: each project (and the Espaço pessoal) is a collapsible folder with its own
// "nova conversa"; chats are dragged from one folder to another to move them (moveChat carries the context along).
export function ConversationTree({
  data,
  chats,
  search,
  setSearch,
  active,
  page,
  goChat,
  projectId,
  setProjectId,
  openNew,
  addProject,
  moveChat,
  taskCounts,
}) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [dropOn, setDropOn] = useState(null);
  const groups = useMemo(() => groupChats(chats, data.projects), [chats, data.projects]);
  const searching = !!search.trim();
  const keys = groups.map((g) => g.key);
  const allCollapsed = keys.length > 0 && keys.every((k) => collapsed.has(k));
  const update = (next) => {
    setCollapsed(next);
    saveCollapsed(next);
  };
  const toggle = (key) => {
    const next = new Set(collapsed);
    next.has(key) ? next.delete(key) : next.add(key);
    update(next);
  };
  const dropProps = (g) => ({
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropOn !== g.key) setDropOn(g.key);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropOn(null);
    },
    onDrop: (e) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      setDropOn(null);
      if (!id) return;
      e.preventDefault();
      const chat = data.chats.find((c) => c.id === id);
      if (chat && (chat.projectId || PERSONAL) !== g.key) moveChat(id, g.project?.id || null);
    },
  });
  return (
    <>
      <div className="sidebar-section conversation-heading">
        <span>CONVERSAS</span>
        <span className="tree-actions">
          <span className="muted">{chats.length.toString().padStart(2, '0')}</span>
          <IconButton
            icon={allCollapsed ? ChevronsUpDown : ChevronsDownUp}
            label={allCollapsed ? 'Expandir tudo' : 'Recolher tudo'}
            onClick={() => update(allCollapsed ? new Set() : new Set(keys))}
          />
          <IconButton icon={FolderPlus} label="Novo projeto" onClick={addProject} />
        </span>
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
        {groups.map((g) => {
          // While searching, every group with a match is open and empty groups step aside.
          if (searching && !g.chats.length) return null;
          const open = searching || !collapsed.has(g.key);
          const Icon = g.project ? Folder : Home;
          return (
            <section
              key={g.key}
              className={'chat-group' + (dropOn === g.key ? ' drop-target' : '')}
              data-group={g.key}
              {...dropProps(g)}
            >
              <div className={'chat-group-head' + ((projectId || PERSONAL) === g.key ? ' current' : '')}>
                <button
                  className="chat-group-toggle"
                  aria-expanded={open}
                  title={g.project?.path || 'Conversas fora de um projeto'}
                  onClick={() => {
                    toggle(g.key);
                    setProjectId(g.project?.id || '');
                  }}
                >
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <Icon size={14} />
                  <span className="truncate">{g.name}</span>
                  <small>{g.chats.length}</small>
                </button>
                <IconButton
                  icon={Plus}
                  label={'Nova conversa em ' + g.name}
                  onClick={() => openNew(g.project?.id || '')}
                />
              </div>
              {open && (
                <div className="chat-group-items">
                  {g.chats.map((c) => (
                    <ChatItem
                      key={c.id}
                      c={c}
                      data={data}
                      taskCounts={taskCounts}
                      selected={active === c.id && page === 'chat'}
                      onOpen={() => goChat(c)}
                    />
                  ))}
                  {!g.chats.length && (
                    <button className="chat-group-empty" onClick={() => openNew(g.project?.id || '')}>
                      Nenhuma conversa. Começar uma
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {!chats.length && (
          <div className="empty-chats">
            <MessageSquare size={20} />
            <span>{search ? 'Nenhuma conversa encontrada' : 'As boas ideias começam\ncom uma conversa.'}</span>
          </div>
        )}
      </div>
    </>
  );
}
