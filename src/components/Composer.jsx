import { PROVIDERS } from '../lib/constants';
import { ProviderPicker } from './ProviderPicker';
import { ModelPicker, EFFORT_LABELS } from './ModelPicker';
import { modelLabel } from '../lib/format';
import { ModeChip } from './ModeChip';
import { MODES, modeOf } from '../lib/modes';
import { ArrowUp, Brain, Folder, Square, LoaderCircle, Paperclip } from 'lucide-react';
import { AttachmentChips } from './AttachmentChips';
import { action } from '../lib/api';
import { useRef, useState } from 'react';
import ClickSpark from './bits/ClickSpark';
import { completeSlash, slashMatches } from '../lib/skills';
import { SlashMenu } from './SlashMenu';
export function Composer({
  running,
  textarea,
  currentProvider,
  input,
  setDraft,
  draftKey,
  send,
  integrations,
  busy,
  chat,
  setData,
  call,
  notify,
  setProvider,
  setNewModel,
  newModel,
  data,
  currentProject,
  active,
  attachments = [],
  onPick,
  onFiles,
  onRemoveAttachment,
}) {
  // "/" + letters at the caret, anywhere in the message: VeSTA's skills that match (Esc hides the menu until the text
  // changes). A message can call several skills.
  const spark = useRef(null); // the send button's ink sparks, also fired when Enter sends
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const [caret, setCaret] = useState(null);
  const menu = !running && !slashClosed ? slashMatches(data.skills?.list, input, caret) : null;
  const slash = menu?.items;
  const pickSlash = (name) => {
    const next = completeSlash(input, menu.token, name);
    setDraft(draftKey, next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => textarea.current?.setSelectionRange(next.caret, next.caret));
    textarea.current?.focus();
  };
  // Only the "/letras" in the box: Enter on the menu sends that skill as it is; otherwise it completes the name.
  const alone = menu && !input.slice(0, menu.token.start).trim() && !input.slice(menu.token.end).trim();
  return (
    <div className="composer-wrap">
      {slash && <SlashMenu items={slash} index={Math.min(slashIndex, slash.length - 1)} onPick={pickSlash} />}
      <div className={'composer ' + (running ? 'is-running' : '')}>
        <AttachmentChips items={attachments} onRemove={onRemoveAttachment} disabled={running || busy} />
        <textarea
          ref={textarea}
          aria-label="Mensagem"
          placeholder={
            running
              ? 'A IA está respondendo…'
              : 'O que vamos criar com ' +
                PROVIDERS[currentProvider].name +
                '?' +
                (data.skills?.list?.some((s) => s.enabled) ? ' Use / para chamar skills.' : '')
          }
          value={input}
          onChange={(e) => {
            setDraft(draftKey, e.target.value);
            setCaret(e.target.selectionStart);
            setSlashIndex(0);
            setSlashClosed(false);
          }}
          onSelect={(e) => setCaret(e.target.selectionStart)}
          onPaste={(e) => {
            // Ctrl+V with files (a screenshot, a copied image or file) attaches them; plain text pastes as usual.
            const files = [...(e.clipboardData?.files || [])];
            if (!files.length) return;
            e.preventDefault();
            onFiles?.(files);
          }}
          onKeyDown={(e) => {
            if (slash?.length) {
              const i = Math.min(slashIndex, slash.length - 1);
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                return setSlashIndex((i + (e.key === 'ArrowDown' ? 1 : slash.length - 1)) % slash.length);
              }
              if (e.key === 'Tab') {
                e.preventDefault();
                return pickSlash(slash[i].name);
              }
              // Enter on the menu: alone in the box, sends the highlighted skill as it is ("/nome"); in a longer
              // message, completes the name like Tab.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!alone) return pickSlash(slash[i].name);
                if (!running) {
                  send('/' + slash[i].name);
                  spark.current?.spark();
                }
                return;
              }
            }
            if (e.key === 'Escape' && slash) {
              e.preventDefault();
              return setSlashClosed(true);
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (running || busy || (!input.trim() && !attachments.length)) return;
              send();
              spark.current?.spark();
            }
          }}
          disabled={running}
          rows={3}
        />
        <div className="composer-bottom">
          <div className="composer-options">
            <button
              type="button"
              className="attach-button"
              aria-label="Anexar arquivos"
              title="Anexar imagens e documentos (ou arraste e solte, ou cole com Ctrl+V)"
              disabled={running || busy}
              onClick={onPick}
            >
              <Paperclip size={15} />
            </button>
            <ProviderPicker
              value={currentProvider}
              integrations={integrations}
              disabled={running || busy}
              onPick={async (provider) => {
                try {
                  if (chat) {
                    setData(await call('switchProvider', { id: chat.id, provider }));
                    notify('IA alterada para ' + PROVIDERS[provider].name);
                  }
                  setProvider(provider);
                  setNewModel(null);
                } catch {}
              }}
            />
            {currentProvider !== 'drael' && (
              <ModelPicker
                value={chat ? chat.model : (newModel ?? (currentProvider === 'opencode' ? 'drael/drael-v1' : ''))}
                models={data.integrations?.[currentProvider]?.models || integrations?.[currentProvider]?.models}
                disabled={running}
                onPick={(m) =>
                  chat
                    ? call('updateChat', { id: chat.id, model: m }).then((r) => {
                        setData(r);
                        notify('Modelo: ' + modelLabel(m));
                      })
                    : setNewModel(m)
                }
                effort={chat?.effort || ''}
                onEffort={
                  chat && ['claude', 'codex'].includes(currentProvider)
                    ? (effort) =>
                        call('updateChat', { id: chat.id, effort }).then((r) => {
                          setData(r);
                          notify('Esforço: ' + EFFORT_LABELS[effort]);
                        })
                    : null
                }
              />
            )}{' '}
            {chat && (
              <ModeChip
                nativeDrael={currentProvider === 'drael'}
                mode={chat.mode}
                disabled={running}
                onPick={(mode) =>
                  call('updateChat', { id: chat.id, mode }).then((r) => {
                    if (r) {
                      setData(r);
                      notify(MODES[mode].label + ' · ' + MODES[mode].hint);
                    }
                  })
                }
              />
            )}
            <span className="composer-divider" />
            <span className="composer-project">
              <Folder size={13} />
              {currentProject?.name || 'Espaço pessoal'}
            </span>
            {data.settings.memoryEnabled && (
              <span className="composer-memory" title="Usar memória compartilhada">
                <Brain size={14} />
              </span>
            )}
          </div>
          <ClickSpark
            ref={spark}
            className="send-spark"
            sparkColor="currentColor"
            sparkCount={10}
            sparkRadius={34}
            sparkSize={12}
            duration={480}
            disabled={running}
            style={{ width: 'auto', height: 'auto' }}
          >
            {running ? (
              <button
                className="send-button stop"
                aria-label="Interromper resposta"
                onClick={action(() => call('stop', { chatId: active }))}
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                aria-label="Enviar mensagem"
                disabled={(!input.trim() && !attachments.length) || busy}
                onClick={() => send()}
              >
                {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}
              </button>
            )}
          </ClickSpark>
        </div>
      </div>
      <div className="composer-footnote">
        <span>{MODES[modeOf(chat?.mode)].foot}</span>
        <span>
          Enter para enviar <span className="keyboard-dot">·</span> Shift + Enter para nova linha
        </span>
      </div>
    </div>
  );
}
