import {
  Plus,
  LayoutGrid,
  MessageSquare,
  Brain,
  Layers,
  Settings,
  BarChart3,
  Activity,
  Swords,
  BookOpen,
  Bot,
} from 'lucide-react';
import { Mark } from './Brand';
import { MascotAvatar, useMascot } from './Mascot';
import { STATE_LABEL } from '../lib/mascot';

const PAGES = [
  { id: 'activity', name: 'Atividade', icon: Activity },
  { id: 'quests', name: 'Quests', icon: Swords },
  { id: 'agents', name: 'Agents', icon: Bot },
  { id: 'memory', name: 'Memória', icon: Brain },
  { id: 'skills', name: 'Skills', icon: BookOpen },
  { id: 'usage', name: 'Uso', icon: BarChart3 },
  { id: 'connections', name: 'Conexões', icon: Layers },
];

// One rail button: icon only, the name shows as a tooltip on hover (and stays in the DOM for screen readers).
function RailItem({ icon: Icon, name, hint, active, onClick, count, live, className = '', ...rest }) {
  return (
    <button
      className={'nav-item rail-item ' + className + (active ? ' active' : '')}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      {...rest}
    >
      <Icon size={18} />
      <span className="rail-label">
        {name}
        {hint && <kbd>{hint}</kbd>}
      </span>
      {count > 0 && (
        <span
          key={count}
          className={'count t-pop' + (live ? ' live' : '')}
          title={live ? name + ' rodando agora' : undefined}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// The left rail: the mascot (opens Atividade), Início, the Conversas drawer, a new chat and the other screens.
export function Rail({
  page,
  setPage,
  drawer,
  toggleDrawer,
  openNew,
  data,
  taskCounts,
  questsRunning = 0,
  agentsBadge,
}) {
  const mascot = useMascot();
  return (
    <nav className="rail" aria-label="Principal">
      <div className="rail-brand">
        {mascot.enabled ? (
          <>
            <MascotAvatar onOpen={() => setPage('activity')} />
            {/* Screen readers hear when the AIs start or stop working (the state, not every phrase). */}
            <span className="sr-only" role="status">
              {STATE_LABEL[mascot.state]}
            </span>
          </>
        ) : (
          <button className="brand-mark" onClick={() => setPage('home')} title="VeSTA">
            <Mark size={28} />
          </button>
        )}
      </div>
      <RailItem icon={LayoutGrid} name="Início" active={page === 'home'} onClick={() => setPage('home')} />
      <RailItem
        icon={MessageSquare}
        name="Conversas"
        hint="Ctrl B"
        active={page === 'chat'}
        className={drawer ? 'drawer-open' : ''}
        aria-expanded={drawer}
        onClick={() => (page === 'chat' ? toggleDrawer() : (setPage('chat'), toggleDrawer(true)))}
      />
      <RailItem icon={Plus} name="Novo chat" hint="Ctrl N" className="new-chat" onClick={() => openNew()} />
      <span className="rail-sep" />
      {PAGES.map((n) => (
        <RailItem
          key={n.id}
          icon={n.icon}
          name={n.name}
          active={page === n.id}
          onClick={() => setPage(n.id)}
          count={
            n.id === 'memory'
              ? data.memories.length
              : n.id === 'skills'
                ? data.skills?.list?.filter((s) => s.enabled).length || 0
                : n.id === 'quests'
                  ? questsRunning
                  : n.id === 'agents'
                    ? agentsBadge?.count || 0
                    : n.id === 'activity'
                      ? taskCounts.total
                      : 0
          }
          live={n.id === 'agents' ? !!agentsBadge?.live : n.id !== 'memory' && n.id !== 'skills'}
        />
      ))}
      <div className="sidebar-bottom">
        <RailItem
          icon={Settings}
          name="Preferências"
          active={page === 'settings' || page === 'about'}
          onClick={() => setPage('settings')}
        />
      </div>
    </nav>
  );
}
