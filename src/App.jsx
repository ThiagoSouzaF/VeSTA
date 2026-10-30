import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { empty } from './lib/constants';
import { useDrafts } from './hooks/useDrafts';
import { usePendingAttachments } from './hooks/usePendingAttachments';
import { stageFiles } from './lib/attachments';
import { useToast } from './hooks/useToast';
import { makeCall, api, signalReady } from './lib/api';
import { applyEvents, createEventBuffer } from './lib/streamBuffer';
import { useFontScale } from './hooks/useFontScale';
import { useNavHistory } from './hooks/useNavHistory';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { Backdrop } from './components/Backdrop';
import { MainHeader } from './components/MainHeader';
import { LoaderCircle } from 'lucide-react';
import { ChatPage } from './components/ChatPage';
import { MemoryPage } from './components/MemoryPage';
import { UsagePage } from './components/UsagePage';
import { ConnectionsPage } from './components/ConnectionsPage';
import { SettingsPage } from './components/SettingsPage';
import { Toast } from './components/Toast';
import { Modal } from './components/modals/Modal';
import { FloatingTerminal } from './components/FloatingTerminal';
import { ActivityPage } from './components/ActivityPage';
import { QuestsPage } from './components/QuestsPage';
import { runningQuests } from './lib/quests';
import { activityGroups, runningCounts } from './lib/activity';
import { MascotProvider } from './components/Mascot';
import { AboutPage } from './components/AboutPage';
export function App() {
  const [data, setData] = useState(empty),
    [integrations, setIntegrations] = useState({}),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState('chat'),
    [active, setActive] = useState(null),
    [provider, setProvider] = useState('codex'),
    [projectId, setProjectId] = useState(''),
    [newModel, setNewModel] = useState(null),
    [search, setSearch] = useState(''),
    [inspector, setInspector] = useState(true),
    [modal, setModal] = useState(null),
    [memoryStatus, setMemoryStatus] = useState(null),
    [instructions, setInstructions] = useState([]),
    [memorySearch, setMemorySearch] = useState(''),
    [memoryFilter, setMemoryFilter] = useState('all'),
    [queryResult, setQueryResult] = useState(null),
    [focus, setFocus] = useState(null),
    [questSel, setQuestSel] = useState(null),
    [busy, setBusy] = useState(false);
  const { drafts, setDraft } = useDrafts({ chats: data.chats, loading });
  const { toast, notify } = useToast();
  const { pending, addPending, removePending, clearPending } = usePendingAttachments({ chats: data.chats, loading });
  const textarea = useRef();
  const chat = data.chats.find((c) => c.id === active),
    currentProvider = chat?.provider || provider,
    currentProjectId = chat?.projectId || projectId,
    currentProject = data.projects.find((p) => p.id === currentProjectId),
    running = data.running.includes(active);
  const draftKey = active ?? 'new',
    input = drafts[draftKey] || '',
    attachments = pending[draftKey] || [];
  const activeRef = useRef(active);
  activeRef.current = page === 'chat' ? active : null;
  const call = useMemo(() => makeCall(notify), [notify]);
  // Stream events are applied once per frame; a full state snapshot already contains whatever was still queued.
  const events = useMemo(
    () =>
      createEventBuffer((batch) =>
        setData((d) => {
          const chats = applyEvents(d.chats, batch);
          return chats === d.chats ? d : { ...d, chats };
        })
      ),
    []
  );
  const replaceData = useCallback(
    (next) => {
      events.discard();
      setData(next);
    },
    [events]
  );
  useEffect(() => {
    if (!api) {
      setLoading(false);
      return;
    }
    api
      .call('bootstrap')
      .then((r) => {
        replaceData(r.state);
        setIntegrations(r.integrations);
        setLoading(false);
        signalReady();
      })
      .catch((e) => {
        notify(e.message);
        setLoading(false);
        signalReady(e.message);
      });
    api
      .call('memoryStatus')
      .then(setMemoryStatus)
      .catch((e) => setMemoryStatus({ connected: false, error: e.message }));
    return api.onEvent((e) => {
      if (e.type === 'state') replaceData(e.state);
      if (e.type === 'nav') navGo(e.dir < 0 ? -1 : 1);
      if ((e.type === 'update' || e.type === 'remote-notice') && e.message) notify(e.message);
      if (e.type === 'permission' && e.permission?.status === 'pending' && e.chatId !== activeRef.current)
        notify('Uma IA pede permissão em outra conversa');
      if (e.type === 'text' || e.type === 'activity' || e.type === 'subagent' || e.type === 'permission')
        events.push(e);
    });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
    document.documentElement.dataset.accent = data.settings.accent;
  }, [data.settings.theme, data.settings.accent]);
  const [fontScale, stepFontScale] = useFontScale(data.settings.fontScale, (fontScale) => setting({ fontScale }));
  useEffect(() => {
    if (!currentProjectId) {
      setInstructions([]);
      return;
    }
    let alive = true;
    api?.call('inspectProject', { id: currentProjectId }).then((r) => {
      if (alive) setInstructions(r);
    });
    return () => {
      alive = false;
    };
  }, [currentProjectId]);
  useEffect(() => {
    const listener = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        openNew();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('search-chats')?.focus();
      }
      if (e.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [provider, projectId]);
  useEffect(() => {
    setNewModel(null);
  }, [provider]);
  function openNew() {
    setModal({
      type: 'new',
      provider,
      projectId,
      model: provider === 'opencode' ? 'drael/drael-v1' : '',
      mode: 'edit',
      agent: 'build',
      memory: true,
    });
  }
  async function createChat(options) {
    const result = await call('createChat', options);
    const c = result.chats[0];
    replaceData(result);
    setActive(c.id);
    setPage('chat');
    setProvider(c.provider);
    setProjectId(c.projectId || '');
    setModal(null);
    return c;
  }
  // Attach: from the file dialog, a drop or a paste. The files are copied right away, so the chips show real thumbnails.
  async function pickFiles() {
    try {
      const r = await call('attachPick');
      if (r.attachments.length) addPending(draftKey, r.attachments);
      if (r.errors.length) notify(r.errors.join(' · '));
    } catch {}
  }
  async function attachFiles(files) {
    const room = 10 - attachments.length;
    if (room <= 0) return notify('No máximo 10 anexos por mensagem');
    if (files.length > room) notify('No máximo 10 anexos por mensagem: só os primeiros foram considerados');
    const items = await stageFiles(files.slice(0, room), { call, notify });
    if (items.length) addPending(draftKey, items);
  }
  async function send(text = input) {
    if ((!text.trim() && !attachments.length) || busy) return;
    setBusy(true);
    try {
      let c = chat;
      if (!c)
        c = await createChat({
          provider,
          projectId: projectId || null,
          model: newModel ?? (provider === 'opencode' ? 'drael/drael-v1' : ''),
          mode: 'edit',
          memory: true,
        });
      setNewModel(null);
      setDraft(c.id, '');
      if (!chat) setDraft('new', '');
      replaceData(await call('send', { chatId: c.id, text, attachments: attachments.map((a) => a.id) }));
      clearPending(c.id, 'new');
    } catch {
    } finally {
      setBusy(false);
      textarea.current?.focus();
    }
  }
  async function addProject() {
    const p = await call('addProject');
    if (p) {
      setProjectId(p.id);
      if (modal?.type === 'new') setModal((m) => ({ ...m, projectId: p.id }));
      notify('Projeto conectado: ' + p.name);
    }
  }
  async function setting(input) {
    try {
      replaceData(await call('saveSettings', input));
    } catch {}
  }
  const goChat = (c, messageId) => {
    setActive(c.id);
    setPage('chat');
    setFocus(messageId ? { chatId: c.id, messageId, nonce: Date.now() } : null);
  };
  // Derived per chat/message with memoization: a text delta only recomputes the message it touched.
  const followingIds = useMemo(() => (data.following || []).map((f) => f.chatId), [data.following]);
  const groups = useMemo(
    () => activityGroups(data.chats, data.running, followingIds),
    [data.chats, data.running, followingIds]
  );
  const counts = useMemo(() => runningCounts(groups), [groups]);
  const questsRunning = useMemo(() => runningQuests(data.quests), [data.quests]);
  // Stable callback for the quests screen: reads the chats through a ref so text deltas do not change its identity.
  const chatsRef = useRef(data.chats);
  chatsRef.current = data.chats;
  const openChatById = useCallback(
    (chatId) => {
      const c = chatsRef.current.find((x) => x.id === chatId);
      if (c) goChat(c);
      else notify('Este chat não existe mais');
    },
    [notify]
  );
  // The quest's own chat (created on demand for quests from before it existed).
  const openQuestChat = useCallback(async (questId) => {
    try {
      const r = await call('questChat', { id: questId });
      replaceData(r.state);
      const c = r.state.chats.find((x) => x.id === r.chatId);
      if (c) goChat(c);
    } catch {}
  }, []);
  const openQuest = useCallback((questId) => {
    setQuestSel(questId);
    setPage('quests');
  }, []);
  const openFromQuestBar = useCallback(
    (chatId, questId) => (chatId ? openChatById(chatId) : openQuestChat(questId)),
    [openChatById, openQuestChat]
  );
  const goPage = (p) => {
    if (p === 'quests') setQuestSel(null);
    setPage(p);
  };
  // Back / forward: every change of page, chat or quest is remembered; entries of deleted chats and quests are skipped.
  const navValid = (e) =>
    (e.page !== 'chat' || !e.active || data.chats.some((c) => c.id === e.active)) &&
    (e.page !== 'quests' || !e.questSel || data.quests.some((q) => q.id === e.questSel));
  const navApply = useCallback((e) => {
    setPage(e.page);
    if (e.page === 'chat') setActive(e.active);
    if (e.page === 'quests') setQuestSel(e.questSel);
  }, []);
  const {
    canBack,
    canForward,
    goBack,
    goForward,
    go: navGo,
  } = useNavHistory({ page, active, questSel }, navValid, navApply);
  useEffect(() => {
    // Alt+Left / Alt+Right and the back / forward buttons of the mouse.
    const keys = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        navGo(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    const mouse = (e) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type === 'mouseup') navGo(e.button === 3 ? -1 : 1);
    };
    window.addEventListener('keydown', keys);
    for (const t of ['mousedown', 'mouseup', 'auxclick']) window.addEventListener(t, mouse);
    return () => {
      window.removeEventListener('keydown', keys);
      for (const t of ['mousedown', 'mouseup', 'auxclick']) window.removeEventListener(t, mouse);
    };
  }, [navGo]);
  const openFromActivity = useCallback(
    (chatId, messageId) => {
      const c = data.chats.find((x) => x.id === chatId);
      if (c) goChat(c, messageId);
    },
    [data.chats]
  );
  // Chats started by a quest live in the quest (its board and its own chat), not in Conversas. A deleted quest's chats
  // come back to the list, so nothing becomes unreachable.
  const questIds = useMemo(() => new Set(data.quests.map((q) => q.id)), [data.quests]);
  const filteredChats = data.chats.filter(
    (c) =>
      !(c.questId && questIds.has(c.questId)) &&
      (!projectId || c.projectId === projectId) &&
      c.title.toLowerCase().includes(search.toLowerCase())
  );
  const shownMemories = data.memories.filter(
    (m) =>
      (memoryFilter === 'all' ||
        (memoryFilter === 'preferences' && m.kind === 'preference') ||
        (memoryFilter === 'insights' && m.kind === 'insight') ||
        (memoryFilter === 'notes' && m.kind !== 'session' && m.kind !== 'preference' && m.kind !== 'insight') ||
        (memoryFilter === 'sessions' && m.kind === 'session')) &&
      (!projectId || m.projectId === projectId || m.kind === 'preference') &&
      (m.title + ' ' + m.body).toLowerCase().includes(memorySearch.toLowerCase())
  );
  const newMemory = () =>
    setModal({ type: 'memory', title: '', body: '', kind: 'preference', projectId: projectId || '' });
  return (
    <MascotProvider data={data} groups={groups}>
      <div className="app-shell">
        <Titlebar />
        <div className="app-body">
          <Sidebar
            openNew={openNew}
            page={page}
            setPage={goPage}
            data={data}
            addProject={addProject}
            projectId={projectId}
            setProjectId={setProjectId}
            setActive={setActive}
            filteredChats={filteredChats}
            search={search}
            setSearch={setSearch}
            active={active}
            goChat={goChat}
            taskCounts={counts}
            questsRunning={questsRunning}
          />
          <main className="main">
            <Backdrop
              kind={data.settings.background || 'rain'}
              theme={data.settings.theme}
              accent={data.settings.accent}
            />
            <MainHeader
              page={page}
              chat={chat}
              data={data}
              memoryStatus={memoryStatus}
              inspector={inspector}
              setInspector={setInspector}
              canBack={canBack}
              canForward={canForward}
              onBack={goBack}
              onForward={goForward}
            />
            {loading ? (
              <div className="loading">
                <LoaderCircle className="spin" />
                <p>Acendendo a chama…</p>
              </div>
            ) : page === 'chat' ? (
              <ChatPage
                chat={chat}
                currentProject={currentProject}
                setModal={setModal}
                call={call}
                running={running}
                notify={notify}
                provider={provider}
                setProvider={setProvider}
                integrations={integrations}
                setDraft={setDraft}
                draftKey={draftKey}
                textarea={textarea}
                currentProvider={currentProvider}
                input={input}
                send={send}
                busy={busy}
                setData={replaceData}
                setNewModel={setNewModel}
                newModel={newModel}
                data={data}
                active={active}
                inspector={inspector}
                projectId={projectId}
                setProjectId={setProjectId}
                addProject={addProject}
                memoryStatus={memoryStatus}
                currentProjectId={currentProjectId}
                setPage={setPage}
                instructions={instructions}
                focus={focus}
                attachments={attachments}
                onPick={pickFiles}
                onFiles={attachFiles}
                onRemoveAttachment={(id) => removePending(draftKey, id)}
                onOpenQuest={openQuest}
                onOpenQuestChat={openFromQuestBar}
              />
            ) : page === 'activity' ? (
              <ActivityPage groups={groups} projects={data.projects} call={call} onOpen={openFromActivity} />
            ) : page === 'quests' ? (
              <QuestsPage
                quests={data.quests}
                projects={data.projects}
                integrations={integrations}
                call={call}
                setData={replaceData}
                onOpenChat={openChatById}
                onOpenQuestChat={openQuestChat}
                selected={questSel}
                setSelected={setQuestSel}
                notify={notify}
              />
            ) : page === 'memory' ? (
              <MemoryPage
                newMemory={newMemory}
                data={data}
                memoryStatus={memoryStatus}
                memoryFilter={memoryFilter}
                setMemoryFilter={setMemoryFilter}
                memorySearch={memorySearch}
                setMemorySearch={setMemorySearch}
                setQueryResult={setQueryResult}
                call={call}
                projectId={projectId}
                queryResult={queryResult}
                shownMemories={shownMemories}
                setModal={setModal}
              />
            ) : page === 'usage' ? (
              <UsagePage call={call} usage={data.usage} />
            ) : page === 'connections' ? (
              <ConnectionsPage
                setBusy={setBusy}
                setIntegrations={setIntegrations}
                call={call}
                notify={notify}
                busy={busy}
                integrations={integrations}
                memoryStatus={memoryStatus}
                setMemoryStatus={setMemoryStatus}
              />
            ) : page === 'about' ? (
              <AboutPage version={data.appVersion} onBack={() => setPage('settings')} />
            ) : (
              <SettingsPage
                data={data}
                setting={setting}
                call={call}
                notify={notify}
                fontScale={fontScale}
                stepFontScale={stepFontScale}
                onAbout={() => setPage('about')}
              />
            )}
          </main>
        </div>
        {toast && <Toast toast={toast} />}
        {modal && (
          <Modal
            setModal={setModal}
            modal={modal}
            data={data}
            addProject={addProject}
            integrations={integrations}
            createChat={createChat}
            busy={busy}
            setBusy={setBusy}
            setData={replaceData}
            call={call}
            notify={notify}
            setActive={setActive}
          />
        )}
        {chat && page === 'chat' && <FloatingTerminal call={call} chat={chat} />}
      </div>
    </MascotProvider>
  );
}
