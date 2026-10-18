import { ChatHeading } from './ChatHeading';
import { MessageList } from './MessageList';
import { Welcome } from './Welcome';
import { Composer } from './Composer';
import { ContextPanel } from './ContextPanel';
export function ChatPage({
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
  setData,
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
}) {
  return (
    <div className="chat-layout">
      <section className="conversation">
        {chat ? (
          <>
            <ChatHeading
              chat={chat}
              currentProject={currentProject}
              setModal={setModal}
              call={call}
              running={running}
            />
            <MessageList chat={chat} call={call} notify={notify} setModal={setModal} running={running} focus={focus} />
          </>
        ) : (
          <Welcome
            provider={provider}
            setProvider={setProvider}
            integrations={integrations}
            setDraft={setDraft}
            draftKey={draftKey}
            textarea={textarea}
          />
        )}
        <Composer
          running={running}
          textarea={textarea}
          currentProvider={currentProvider}
          input={input}
          setDraft={setDraft}
          draftKey={draftKey}
          send={send}
          integrations={integrations}
          busy={busy}
          chat={chat}
          setData={setData}
          call={call}
          notify={notify}
          setProvider={setProvider}
          setNewModel={setNewModel}
          newModel={newModel}
          data={data}
          currentProject={currentProject}
          active={active}
        />
      </section>
      {inspector && (
        <ContextPanel
          chat={chat}
          currentProject={currentProject}
          projectId={projectId}
          setProjectId={setProjectId}
          data={data}
          addProject={addProject}
          call={call}
          memoryStatus={memoryStatus}
          currentProjectId={currentProjectId}
          setPage={setPage}
          instructions={instructions}
        />
      )}
    </div>
  );
}
