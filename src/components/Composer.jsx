import { PROVIDERS } from '../lib/constants';
import { ProviderPicker } from './ProviderPicker';
import { ModelPicker } from './ModelPicker';
import { modelLabel } from '../lib/format';
import { ModeChip } from './ModeChip';
import { MODES, modeOf } from '../lib/modes';
import { ArrowUp, Brain, Folder, Square, LoaderCircle } from 'lucide-react';
import { action } from '../lib/api';
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
}) {
  return (
    <div className="composer-wrap">
      <div className={'composer ' + (running ? 'is-running' : '')}>
        <textarea
          ref={textarea}
          aria-label="Mensagem"
          placeholder={
            running ? 'A IA está respondendo…' : 'O que vamos criar com ' + PROVIDERS[currentProvider].name + '?'
          }
          value={input}
          onChange={(e) => setDraft(draftKey, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!running) send();
            }
          }}
          disabled={running}
          rows={3}
        />
        <div className="composer-bottom">
          <div className="composer-options">
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
              disabled={!input.trim() || busy}
              onClick={() => send()}
            >
              {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}
            </button>
          )}
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
