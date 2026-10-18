import { useCallback, useMemo, useState } from 'react';
import { Bot, Cog, Square, Terminal, Users } from 'lucide-react';
import { Empty } from '../components/ui';
import { ProviderIcon } from '../../../src/components/ProviderIcon';
import { TaskNode } from '../../../src/components/TaskTree';
import { PROVIDERS } from '../../../src/lib/constants';
import { RECENT_MS, activityGroups, filterGroups, summarize } from '../../../src/lib/activity';
import { useNow } from '../../../src/hooks/useNow';

const Chip = ({ icon: Icon, n, label }) => (
  <div className={'chip' + (n ? ' hot' : '')}>
    <Icon size={16} />
    <strong>{n}</strong>
    <span>{label}</span>
  </div>
);

// Same selectors as the desktop Activity screen (src/lib/activity.js): only the layout differs.
export function ActivityScreen({ chats, running, projects, call, onOpenChat, notify }) {
  const [scope, setScope] = useState('running');
  const now = useNow(true, 30000);
  const groups = useMemo(() => activityGroups(chats, running), [chats, running]);
  const sum = useMemo(() => summarize(groups), [groups]);
  const cutoff = Math.floor((now - RECENT_MS) / 60000) * 60000;
  const shown = useMemo(() => filterGroups(groups, { scope, now }), [groups, scope, cutoff]);
  const names = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  const stopTask = useCallback(
    (t) => call('stopTask', { chatId: t.chatId, taskId: t.taskId }).catch((e) => notify(e.message)),
    [call, notify]
  );
  return (
    <>
      <div className="chips" role="status">
        <Chip icon={Users} n={sum.working} label={sum.working === 1 ? 'IA trabalhando' : 'IAs trabalhando'} />
        <Chip icon={Bot} n={sum.subagents} label={sum.subagents === 1 ? 'subagente' : 'subagentes'} />
        <Chip icon={Terminal} n={sum.commands} label={sum.commands === 1 ? 'comando' : 'comandos'} />
        <Chip icon={Cog} n={sum.background} label="em segundo plano" />
      </div>
      <div className="segmented" role="tablist" aria-label="Escopo">
        {[
          ['running', 'Rodando'],
          ['all', 'Recentes'],
        ].map(([id, name]) => (
          <button
            key={id}
            role="tab"
            aria-selected={scope === id}
            className={scope === id ? 'on' : ''}
            onClick={() => setScope(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {shown.length ? (
        shown.map((g) => (
          <section className={'activity-card' + (g.live ? ' live' : '')} key={g.chatId} data-chat={g.chatId}>
            <header>
              <ProviderIcon id={g.provider} small />
              <button className="activity-title" onClick={() => onOpenChat(g.chatId)}>
                <strong className="truncate">{g.title}</strong>
                <span className="muted truncate">
                  {PROVIDERS[g.provider]?.name}
                  {names[g.projectId] ? ' · ' + names[g.projectId] : ''}
                </span>
              </button>
              {g.live && (
                <button
                  className="btn small danger"
                  onClick={() => call('stop', { chatId: g.chatId }).catch((e) => notify(e.message))}
                >
                  <Square size={12} /> Parar
                </button>
              )}
            </header>
            <div className="task-tree">
              {g.turns
                .filter(
                  (t, i) => scope === 'all' || t.counts.running > 0 || t.status === 'running' || (g.live && i === 0)
                )
                .map((t, i) => (
                  <TaskNode
                    key={t.messageId}
                    node={t.root}
                    live={g.live && i === 0}
                    onStopTask={stopTask}
                    onOpen={onOpenChat}
                    defaultOpen
                  />
                ))}
            </div>
          </section>
        ))
      ) : (
        <Empty title="Nada rodando agora">
          Quando uma IA estiver trabalhando, subagentes, comandos e tarefas aparecem aqui ao vivo.
        </Empty>
      )}
    </>
  );
}
