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
import { PageRouter } from './components/PageRouter';
import { Toast } from './components/Toast';
import { Modal } from './components/modals/Modal';
import { FloatingTerminal } from './components/FloatingTerminal';
import { runningQuests } from './lib/quests';
import { activityGroups, runningCounts } from './lib/activity';
import { MascotProvider } from './components/Mascot';
import { useDocumentTheme } from './hooks/useDocumentTheme';
import { useNavShortcuts } from './hooks/useNavShortcuts';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { filterChats, filterMemories } from './lib/filters';
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
      if ((e.type === 'update' || e.type === 'remote-notice' || e.type === 'notice') && e.message) notify(e.message);
      // A chat asked to show a part of Preferências (vesta_open_settings).
      if (e.type === 'open-settings') {
        setPage('settings');
        setTimeout(
          () => document.querySelector('[data-section="' + e.section + '"]')?.scrollIntoView({ block: 'start' }),
          120
        );
      }
      if (e.type === 'permission' && e.permission?.status === 'pending' && e.chatId !== activeRef.current)
        notify('Uma IA pede permissão em outra conversa');
      if (e.type === 'text' || e.type === 'activity' || e.type === 'subagent' || e.type === 'permission')
        events.push(e);
    });
  }, []);
  useDocumentTheme(data.settings.theme, data.settings.accent);
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
  useGlobalShortcuts({ openNew, closeModal: () => setModal(null) });
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
  useNavShortcuts(navGo);
  const openFromActivity = useCallback(
    (chatId, messageId) => {
      const c = data.chats.find((x) => x.id === chatId);
      if (c) goChat(c, messageId);
    },
    [data.chats]
  );
  const filteredChats = filterChats(data.chats, data.quests, { projectId, search });
  const shownMemories = filterMemories(data.memories, { filter: memoryFilter, projectId, search: memorySearch });
  const newMemory = () =>
    setModal({ type: 'memory', title: '', body: '', kind: 'preference', projectId: projectId || '' });
  const pageProps = {
    chat: {
      chat,
      currentProject,
      setModal,
      call,
      running,
      notify,
      provider,
      setProvider,
      integrations,
      setDraft,
      draftKey,
      textarea,
      currentProvider,
      input,
      send,
      busy,
      setData: replaceData,
      setNewModel,
      newModel,
      data,
      active,
      inspector,
      projectId,
      setProjectId,
      addProject,
      memoryStatus,
      currentProjectId,
      setPage,
      instructions,
      focus,
      attachments,
      onPick: pickFiles,
      onFiles: attachFiles,
      onRemoveAttachment: (id) => removePending(draftKey, id),
      onOpenQuest: openQuest,
      onOpenQuestChat: openFromQuestBar,
    },
    activity: { groups, projects: data.projects, call, onOpen: openFromActivity },
    quests: {
      quests: data.quests,
      projects: data.projects,
      integrations,
      call,
      setData: replaceData,
      onOpenChat: openChatById,
      onOpenQuestChat: openQuestChat,
      selected: questSel,
      setSelected: setQuestSel,
      notify,
    },
    memory: {
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
    },
    usage: { call, usage: data.usage },
    connections: { setBusy, setIntegrations, call, notify, busy, integrations, memoryStatus, setMemoryStatus },
    about: { version: data.appVersion, onBack: () => setPage('settings') },
    settings: { data, setting, call, notify, fontScale, stepFontScale, onAbout: () => setPage('about') },
  };
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
            <PageRouter page={page} loading={loading} props={pageProps} />
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
