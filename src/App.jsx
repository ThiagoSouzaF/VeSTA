import { useState, useRef, useEffect } from 'react';
import { empty } from './lib/constants';
import { useDrafts } from './hooks/useDrafts';
import { useToast } from './hooks/useToast';
import { makeCall, api } from './lib/api';
import { patchMessage } from './lib/messages';
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
    [busy, setBusy] = useState(false);
  const { drafts, setDraft } = useDrafts({ chats: data.chats, loading });
  const { toast, notify } = useToast();
  const bottom = useRef(),
    textarea = useRef();
  const chat = data.chats.find((c) => c.id === active),
    currentProvider = chat?.provider || provider,
    currentProjectId = chat?.projectId || projectId,
    currentProject = data.projects.find((p) => p.id === currentProjectId),
    running = data.running.includes(active);
  const draftKey = active ?? 'new',
    input = drafts[draftKey] || '';
  const activeRef = useRef(active);
  activeRef.current = page === 'chat' ? active : null;
  const call = makeCall(notify);
  useEffect(() => {
    if (!api) {
      setLoading(false);
      return;
    }
    api
      .call('bootstrap')
      .then((r) => {
        setData(r.state);
        setIntegrations(r.integrations);
        setLoading(false);
      })
      .catch((e) => {
        notify(e.message);
        setLoading(false);
      });
    api
      .call('memoryStatus')
      .then(setMemoryStatus)
      .catch((e) => setMemoryStatus({ connected: false, error: e.message }));
    return api.onEvent((e) => {
      if (e.type === 'state') setData(e.state);
      if (e.type === 'update' && e.message) notify(e.message);
      if (e.type === 'permission' && e.permission?.status === 'pending' && e.chatId !== activeRef.current)
        notify('Uma IA pede permissão em outra conversa');
      if (e.type === 'text' || e.type === 'activity' || e.type === 'subagent' || e.type === 'permission')
        setData((d) => ({
          ...d,
          chats: d.chats.map((c) =>
            c.id !== e.chatId
              ? c
              : { ...c, messages: c.messages.map((m) => (m.id !== e.messageId ? m : patchMessage(m, e))) }
          ),
        }));
    });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
    document.documentElement.dataset.accent = data.settings.accent;
  }, [data.settings.theme, data.settings.accent]);
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
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active, chat?.messages.at(-1)?.text, chat?.messages.at(-1)?.status]);
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
    setData(result);
    setActive(c.id);
    setPage('chat');
    setProvider(c.provider);
    setProjectId(c.projectId || '');
    setModal(null);
    return c;
  }
  async function send(text = input) {
    if (!text.trim() || busy) return;
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
      setData(await call('send', { chatId: c.id, text }));
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
      setData(await call('saveSettings', input));
    } catch {}
  }
  const goChat = (c) => {
    setActive(c.id);
    setPage('chat');
  };
  const filteredChats = data.chats.filter(
    (c) => (!projectId || c.projectId === projectId) && c.title.toLowerCase().includes(search.toLowerCase())
  );
  const shownMemories = data.memories.filter(
    (m) =>
      (memoryFilter === 'all' ||
        (memoryFilter === 'preferences' && m.kind === 'preference') ||
        (memoryFilter === 'notes' && m.kind !== 'session' && m.kind !== 'preference') ||
        (memoryFilter === 'sessions' && m.kind === 'session')) &&
      (!projectId || m.projectId === projectId || m.kind === 'preference') &&
      (m.title + ' ' + m.body).toLowerCase().includes(memorySearch.toLowerCase())
  );
  const newMemory = () =>
    setModal({ type: 'memory', title: '', body: '', kind: 'preference', projectId: projectId || '' });
  return (
    <div className="app-shell">
      <Titlebar />
      <div className="app-body">
        <Sidebar
          openNew={openNew}
          page={page}
          setPage={setPage}
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
              bottom={bottom}
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
              setData={setData}
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
          ) : (
            <SettingsPage data={data} setting={setting} call={call} notify={notify} />
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
          setData={setData}
          call={call}
          notify={notify}
          setActive={setActive}
        />
      )}
      {chat && page === 'chat' && <FloatingTerminal call={call} chat={chat} />}
    </div>
  );
}
