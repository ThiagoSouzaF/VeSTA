import { ChatHeading } from './ChatHeading';
import { MessageList } from './MessageList';
import { Welcome } from './Welcome';
import { Composer } from './Composer';
import { ContextPanel } from './ContextPanel';
import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { hasFiles } from '../lib/attachments';
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
  attachments,
  onPick,
  onFiles,
  onRemoveAttachment,
}) {
  const [dropping, setDropping] = useState(false);
  // Dropping files anywhere over the conversation attaches them (the highlight follows the pointer).
  const drag = {
    onDragEnter: (e) => hasFiles(e) && !running && (e.preventDefault(), setDropping(true)),
    onDragOver: (e) => hasFiles(e) && (e.preventDefault(), (e.dataTransfer.dropEffect = running ? 'none' : 'copy')),
    onDragLeave: (e) => !e.currentTarget.contains(e.relatedTarget) && setDropping(false),
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropping(false);
      if (!running) onFiles([...e.dataTransfer.files]);
    },
  };
  return (
    <div className="chat-layout">
      <section className={'conversation' + (dropping ? ' is-dropping' : '')} {...drag}>
        {dropping && (
          <div className="drop-overlay" data-testid="drop-overlay">
            <Paperclip size={26} />
            <strong>Solte para anexar</strong>
            <span>Imagens, PDF, texto, código e documentos Office</span>
          </div>
        )}
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
          attachments={attachments}
          onPick={onPick}
          onFiles={onFiles}
          onRemoveAttachment={onRemoveAttachment}
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
