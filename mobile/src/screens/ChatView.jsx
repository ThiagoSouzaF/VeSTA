import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, LoaderCircle, Settings2, Square, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import tasks from '../../../electron/tasks.cjs';
import { Mascot, Sheet } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ProviderIcon } from '../../../src/components/ProviderIcon';
import { ModeChoice } from './Chats';
import { PROVIDERS } from '../../../src/lib/constants';
import { messageActivity } from '../../../src/lib/activity';
import { modelLabel } from '../../../src/lib/format';
import { chatMood } from '../lib/state';
import { modeLabel } from '../lib/modes';

const PERM_TEXT = {
  allowed: 'Permitido',
  always: 'Permitido e lembrado',
  auto: 'Permitido pela regra da conversa',
  denied: 'Negado',
  expired: 'Expirou',
  cancelled: 'Cancelado',
};
const Message = memo(function Message({ chat, m, live, onOpenActivity }) {
  if (m.role === 'user')
    return (
      <div className="msg user" data-message={m.id}>
        <div className="bubble">{m.text}</div>
      </div>
    );
  const act = m.activities?.length || m.subagents?.length ? messageActivity(chat, m, live) : null;
  const summary = act ? tasks.summaryLine(act.counts) : '';
  return (
    <div className={'msg assistant ' + (m.status || '')} data-message={m.id}>
      <div className="msg-head">
        <ProviderIcon id={m.provider || chat.provider} small />
        <span>{PROVIDERS[m.provider || chat.provider]?.name}</span>
        {m.status === 'running' && <LoaderCircle size={13} className="spin" />}
        {m.status === 'cancelled' && <span className="muted">interrompida</span>}
      </div>
      {m.text ? <Markdown text={m.text} /> : m.status === 'running' && <p className="muted typing">Pensando…</p>}
      {summary && (
        <button className="activity-pill" onClick={onOpenActivity}>
          {act.counts.running > 0 && <LoaderCircle size={12} className="spin" />} {summary}
        </button>
      )}
      {(m.permissions || [])
        .filter((p) => p.status !== 'pending')
        .map((p) => (
          <div className={'perm-line ' + p.status} key={p.id}>
            {['denied', 'expired', 'cancelled'].includes(p.status) ? <ShieldX size={13} /> : <ShieldCheck size={13} />}
            <span>{PERM_TEXT[p.status] || p.status}</span>
            <code className="truncate">{p.command || p.title}</code>
          </div>
        ))}
      {(m.permissions || []).some((p) => p.status === 'pending') && (
        <div className="perm-line pending">
          <ShieldAlert size={13} /> Aguardando sua resposta
        </div>
      )}
      {m.error && <p className="msg-error">{m.error}</p>}
    </div>
  );
});

export function ChatView({ chat, running, waiting, done, integrations, call, onBack, onOpenActivity, notify }) {
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false);
  const list = useRef(null),
    stick = useRef(true),
    input = useRef(null);
  const last = chat.messages[chat.messages.length - 1];
  const mood = chatMood(chat, { running, waiting, done });
  useLayoutEffect(() => {
    if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [chat.messages.length, last?.text, last?.status, last?.activities?.length]);
  useEffect(() => {
    stick.current = true;
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [chat.id]);
  const onScroll = () => {
    const el = list.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  async function send() {
    const value = text.trim();
    if (!value || busy || running) return;
    setBusy(true);
    setText('');
    stick.current = true;
    try {
      await call('send', { chatId: chat.id, text: value });
    } catch (e) {
      setText(value);
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const grow = (el) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };
  useEffect(() => {
    if (!text && input.current) input.current.style.height = 'auto';
  }, [text]);
  const liveId = running ? last?.id : null;
  return (
    <div className="chat-view">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar">
          <ArrowLeft size={22} />
        </button>
        <Mascot mood={mood} size={34} face />
        <div className="topbar-title">
          <strong className="truncate">{chat.title}</strong>
          <span className="truncate muted">
            {PROVIDERS[chat.provider]?.name} · {modelLabel(chat.model)} · {modeLabel(chat.mode)}
          </span>
        </div>
        <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Modelo e modo">
          <Settings2 size={20} />
        </button>
      </header>
      <div className="messages" ref={list} onScroll={onScroll} data-testid="messages">
        {chat.hiddenMessages > 0 && (
          <p className="muted center small">{chat.hiddenMessages} mensagens anteriores ficam só no desktop.</p>
        )}
        {chat.messages.map((m) => (
          <Message key={m.id} chat={chat} m={m} live={m.id === liveId} onOpenActivity={onOpenActivity} />
        ))}
        {!chat.messages.length && <p className="muted center">Escreva a primeira mensagem.</p>}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={input}
          rows={1}
          value={text}
          aria-label="Mensagem"
          placeholder={running ? 'A IA está respondendo…' : 'Mensagem'}
          onChange={(e) => {
            setText(e.target.value);
            grow(e.target);
          }}
        />
        {running ? (
          <button
            type="button"
            className="send stop"
            aria-label="Parar"
            onClick={() => call('stop', { chatId: chat.id }).catch((e) => notify(e.message))}
          >
            <Square size={18} />
          </button>
        ) : (
          <button className="send" aria-label="Enviar" disabled={!text.trim() || busy}>
            <ArrowUp size={20} />
          </button>
        )}
      </form>
      {settings && (
        <ChatSettings
          chat={chat}
          running={running}
          models={integrations[chat.provider]?.models || []}
          onClose={() => setSettings(false)}
          onSave={async (patch) => {
            await call('updateChat', { id: chat.id, ...patch });
          }}
        />
      )}
    </div>
  );
}

function ChatSettings({ chat, running, models, onClose, onSave }) {
  const [mode, setMode] = useState(chat.mode),
    [model, setModel] = useState(chat.model || ''),
    [error, setError] = useState('');
  const options = useMemo(() => [...new Set(['', chat.model || '', ...models])], [models, chat.model]);
  const save = async (patch) => {
    setError('');
    try {
      await onSave(patch);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <Sheet title="Modelo e modo" onClose={onClose}>
      {running && <p className="notice">Aguarde a resposta terminar para trocar o modelo ou o modo.</p>}
      <label className="field">
        <span className="label">Modelo</span>
        <select
          value={model}
          disabled={running}
          onChange={(e) => {
            setModel(e.target.value);
            save({ model: e.target.value });
          }}
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {modelLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <fieldset disabled={running} className="plain">
        <ModeChoice
          value={mode}
          provider={chat.provider}
          onChange={(m) => {
            setMode(m);
            save({ mode: m });
          }}
        />
      </fieldset>
      {error && <p className="form-error">{error}</p>}
    </Sheet>
  );
}
