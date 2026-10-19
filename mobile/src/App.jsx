import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bell, BellOff, Gauge, LogOut, MessageSquare, Swords, WifiOff } from 'lucide-react';
import { PairScreen } from './screens/Pair';
import { ChatsScreen } from './screens/Chats';
import { ChatView } from './screens/ChatView';
import { ActivityScreen } from './screens/Activity';
import { QuestsScreen, QuestDetailScreen } from './screens/Quests';
import { UsageScreen } from './screens/Usage';
import { PermissionSheet } from './components/PermissionSheet';
import { Empty, Mascot, MascotCtx, Sheet } from './components/ui';
import { useMascotState } from '../../src/hooks/useMascotState';
import { useRemote } from './hooks/useRemote';
import { pairingCode, parseRoute, pendingPermissions } from './lib/state';
import { askNotifications, notificationState } from './lib/notify';
import { forget, saved } from './lib/client';

const TABS = [
  ['chats', 'Conversas', MessageSquare],
  ['atividade', 'Atividade', Activity],
  ['quests', 'Quests', Swords],
  ['uso', 'Uso', Gauge],
];
const go = (path) => {
  location.hash = path;
};
function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function App() {
  // The pairing code arrives in the URL fragment (never sent to the server); it is removed from the address bar at once.
  const [initialCode] = useState(() => {
    const code = pairingCode(location.hash);
    if (code) history.replaceState(null, '', location.pathname + location.search);
    return code;
  });
  const [token, setToken] = useState(() => saved().token);
  const [notice, setNotice] = useState('');
  if (!token)
    return (
      <PairScreen
        initialCode={initialCode}
        notice={notice}
        onPaired={(t) => {
          setNotice('');
          setToken(t);
        }}
      />
    );
  return (
    <Signed
      token={token}
      onSignOut={(reason) => {
        forget();
        setNotice(typeof reason === 'string' ? reason : '');
        setToken(null);
      }}
    />
  );
}

function Signed({ token, onSignOut }) {
  const remote = useRemote(token, onSignOut);
  const { state, done, integrations, online, loaded, call, upload } = remote;
  const route = useRoute();
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState(false);
  const notify = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(''), 4000);
  }, []);
  // Same theme and accent as the desktop.
  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.theme) root.dataset.theme = state.settings.theme;
    if (state.settings.accent) root.dataset.accent = state.settings.accent;
  }, [state.settings.theme, state.settings.accent]);
  const pending = useMemo(() => pendingPermissions(state.chats), [state.chats]);
  const waitingIds = useMemo(() => new Set(pending.map((x) => x.chat.id)), [pending]);
  const mascot = useMascotState(state, undefined, { online });
  const showMascot = state.settings.mascot !== false;
  const mascotCtx = useMemo(() => ({ enabled: showMascot, ...mascot }), [showMascot, mascot]);
  const openChat = useCallback((id) => go('#/chat/' + id), []);
  const chat = route.name === 'chat' ? state.chats.find((c) => c.id === route.id) : null;
  const quest = route.name === 'quest' ? state.quests.find((q) => q.id === route.id) : null;
  const tab = route.name === 'chat' ? 'chats' : route.name === 'quest' ? 'quests' : route.name;
  const answer = useCallback((id, decision) => call('answerPermission', { id, decision }), [call]);
  const questAct = useCallback((method, args) => call(method, args), [call]);
  const title = { chats: 'Conversas', atividade: 'Atividade', quests: 'Quests', uso: 'Uso' }[tab];
  const detail = (route.name === 'chat' && chat) || (route.name === 'quest' && quest);

  return (
    <MascotCtx.Provider value={mascotCtx}>
      <div className="app">
        {!online && (
          <div className="offline" role="status">
            <WifiOff size={14} /> {loaded ? 'Sem conexão com o computador. Reconectando…' : 'Conectando ao computador…'}
          </div>
        )}
        {detail ? (
          route.name === 'chat' ? (
            <ChatView
              chat={chat}
              running={state.running.includes(chat.id)}
              waiting={waitingIds.has(chat.id)}
              done={done[chat.id]}
              integrations={integrations}
              call={call}
              upload={upload}
              notify={notify}
              onBack={() => history.back()}
              onOpenActivity={() => go('#/atividade')}
            />
          ) : (
            <QuestDetailScreen
              quest={quest}
              projects={state.projects}
              onBack={() => go('#/quests')}
              onAct={questAct}
              onOpenChat={openChat}
            />
          )
        ) : (
          <>
            <header className="topbar main">
              {showMascot && <Mascot mood={mascot.state} size={42} face label />}
              <div className="topbar-title">
                <strong>{title}</strong>
                <span className="muted">{mascot.phrase}</span>
              </div>
              <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Menu do aparelho">
                {notificationState() === 'granted' ? <Bell size={20} /> : <BellOff size={20} />}
              </button>
            </header>
            <main className="scroll" data-screen={tab}>
              {!loaded && online && <p className="muted center">Carregando…</p>}
              {(route.name === 'chat' || route.name === 'quest') && loaded && (
                <Empty title="Não encontrado">Este item não existe mais.</Empty>
              )}
              {tab === 'chats' && route.name === 'chats' && (
                <ChatsScreen
                  chats={state.chats}
                  projects={state.projects}
                  running={state.running}
                  waitingIds={waitingIds}
                  done={done}
                  integrations={integrations}
                  onOpen={openChat}
                  onCreate={async (input) => {
                    const r = await call('createChat', input);
                    openChat(r.chat.id);
                  }}
                />
              )}
              {route.name === 'atividade' && (
                <ActivityScreen
                  chats={state.chats}
                  running={state.running}
                  projects={state.projects}
                  call={call}
                  onOpenChat={openChat}
                  notify={notify}
                />
              )}
              {route.name === 'quests' && (
                <QuestsScreen
                  quests={state.quests}
                  projects={state.projects}
                  onOpen={(id) => go('#/quest/' + id)}
                  onCreate={(input) => call('createQuest', input)}
                />
              )}
              {route.name === 'uso' && <UsageScreen call={call} />}
            </main>
            <nav className="tabbar" aria-label="Seções">
              {TABS.map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={tab === id ? 'on' : ''}
                  aria-current={tab === id ? 'page' : undefined}
                  onClick={() => go('#/' + id)}
                >
                  <Icon size={22} />
                  <span>{label}</span>
                  {id === 'chats' && pending.length > 0 && <i className="dot warn" />}
                  {id === 'atividade' && state.running.length > 0 && <i className="dot live" />}
                </button>
              ))}
            </nav>
          </>
        )}
        <PermissionSheet items={pending} onAnswer={answer} onOpenChat={openChat} />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        {menu && <DeviceMenu onClose={() => setMenu(false)} onSignOut={onSignOut} version={state.appVersion} />}
      </div>
    </MascotCtx.Provider>
  );
}

function DeviceMenu({ onClose, onSignOut, version }) {
  const [perm, setPerm] = useState(notificationState());
  return (
    <Sheet title={saved().device || 'Este aparelho'} onClose={onClose}>
      <p className="muted">
        Para revogar o acesso deste aparelho, abra Preferências, Controle remoto no VeSTA do computador.
      </p>
      {perm === 'default' && (
        <button className="btn primary big" onClick={async () => setPerm(await askNotifications())}>
          <Bell size={18} /> Avisar quando uma IA pedir permissão
        </button>
      )}
      {perm === 'granted' && (
        <p className="notice">Avisos ativados enquanto o app estiver aberto ou em segundo plano.</p>
      )}
      {perm === 'denied' && <p className="muted">Os avisos estão bloqueados nas configurações do navegador.</p>}
      {perm === 'unsupported' && <p className="muted">Este navegador não oferece avisos.</p>}
      <button className="btn danger big" onClick={onSignOut}>
        <LogOut size={18} /> Sair deste aparelho
      </button>
      {version && <small className="muted center">VeSTA {version}</small>}
    </Sheet>
  );
}
