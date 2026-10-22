import { memo, useMemo, useState } from 'react';
import { Plus, ShieldAlert } from 'lucide-react';
import { Badge, Empty, Mascot, Sheet } from '../components/ui';
import { ProviderIcon } from '../../../src/components/ProviderIcon';
import { PROVIDERS } from '../../../src/lib/constants';
import { MODES } from '../lib/modes';
import { chatMood, snippet } from '../lib/state';
import { formatDate } from '../../../src/lib/format';

const Row = memo(
  function Row({ chat, projectName, running, waiting, done, onOpen }) {
    const mood = chatMood(chat, { running, waiting, done });
    return (
      <li>
        <button className={'chat-row' + (running ? ' live' : '')} data-chat={chat.id} onClick={() => onOpen(chat.id)}>
          <Mascot mood={mood} size={42} face />
          <span className="chat-row-main">
            <strong className="truncate">{chat.title}</strong>
            <span className="truncate muted">{snippet(chat) || 'Sem mensagens ainda'}</span>
            <span className="chat-row-meta">
              <ProviderIcon id={chat.provider} small />
              <span>{PROVIDERS[chat.provider]?.name}</span>
              <span>· {projectName || 'Espaço pessoal'}</span>
              <span>· {formatDate(chat.updatedAt)}</span>
            </span>
          </span>
          <span className="chat-row-badges">
            {waiting && (
              <Badge tone="warn">
                <ShieldAlert size={12} /> permissão
              </Badge>
            )}
            {running && !waiting && <Badge tone="live">trabalhando</Badge>}
            {chat.mode === 'ask' && !running && <Badge>pede permissão</Badge>}
          </span>
        </button>
      </li>
    );
  },
  (a, b) =>
    a.chat === b.chat &&
    a.projectName === b.projectName &&
    a.running === b.running &&
    a.waiting === b.waiting &&
    a.done === b.done &&
    a.onOpen === b.onOpen
);

export function ChatsScreen({
  chats,
  quests = [],
  projects,
  running,
  waitingIds,
  done,
  integrations,
  onOpen,
  onCreate,
}) {
  const [creating, setCreating] = useState(false);
  const names = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  // Quest chats are reached from the quest, not listed here (same rule as the desktop's Conversas).
  const sorted = useMemo(() => {
    const live = new Set(quests.map((q) => q.id));
    return chats
      .filter((c) => !(c.questId && live.has(c.questId)))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [chats, quests]);
  const runningSet = useMemo(() => new Set(running), [running]);
  return (
    <>
      {sorted.length ? (
        <ul className="chat-list">
          {sorted.map((c) => (
            <Row
              key={c.id}
              chat={c}
              projectName={names[c.projectId]}
              running={runningSet.has(c.id)}
              waiting={waitingIds.has(c.id)}
              done={done[c.id]}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : (
        <Empty mascot title="Nenhuma conversa ainda">
          Crie uma conversa com a sua IA preferida.
        </Empty>
      )}
      <button className="fab" onClick={() => setCreating(true)} aria-label="Nova conversa">
        <Plus size={26} />
      </button>
      {creating && (
        <NewChat
          projects={projects}
          integrations={integrations}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            await onCreate(input);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

function NewChat({ projects, integrations, onClose, onCreate }) {
  const available = Object.values(integrations).filter((i) => i.installed);
  const [provider, setProvider] = useState(available[0]?.id || 'claude'),
    [projectId, setProjectId] = useState(''),
    [mode, setMode] = useState('ask'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const effectiveMode = provider === 'drael' && mode === 'ask' ? 'read' : mode;
  async function create() {
    setBusy(true);
    setError('');
    try {
      await onCreate({ provider, projectId: projectId || null, mode: effectiveMode, memory: true });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Sheet title="Nova conversa" onClose={onClose}>
      <div className="field">
        <span className="label">IA</span>
        <div className="choices">
          {available.map((i) => (
            <button
              key={i.id}
              className={'choice' + (provider === i.id ? ' on' : '')}
              onClick={() => setProvider(i.id)}
              aria-pressed={provider === i.id}
            >
              <ProviderIcon id={i.id} small /> {PROVIDERS[i.id]?.name}
            </button>
          ))}
          {!available.length && <p className="muted">Nenhuma IA instalada no computador.</p>}
        </div>
      </div>
      <label className="field">
        <span className="label">Projeto</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Espaço pessoal</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <ModeChoice value={effectiveMode} onChange={setMode} provider={provider} />
      {error && <p className="form-error">{error}</p>}
      <button className="btn primary big" disabled={busy || !available.length} onClick={create}>
        Criar conversa
      </button>
    </Sheet>
  );
}

export function ModeChoice({ value, onChange, provider }) {
  return (
    <div className="field">
      <span className="label">Modo</span>
      <div className="choices col">
        {Object.entries(MODES).map(([id, m]) => (
          <button
            key={id}
            className={'choice wide' + (value === id ? ' on' : '')}
            disabled={provider === 'drael' && id === 'ask'}
            onClick={() => onChange(id)}
            aria-pressed={value === id}
          >
            <strong>{m.label}</strong>
            <small>{m.hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
