import { memo, useCallback, useMemo, useState } from 'react';
import { Activity, Bot, Cog, FolderOpen, Square, Terminal, Users } from 'lucide-react';
import { ProviderIcon } from './ProviderIcon';
import { TaskNode } from './TaskTree';
import { PROVIDERS } from '../lib/constants';
import { RECENT_MS, filterGroups, summarize } from '../lib/activity';
import { useNow } from '../hooks/useNow';

// A turn is shown while it runs or inside the recent window (whole minutes, so groups do not re-render each second).
const turnVisible = (t, scope, cutoff) =>
  t.counts.running > 0 || t.status === 'running' || (scope === 'all' && t.lastAt >= cutoff);

const GroupCard = memo(function GroupCard({ group, projectName, scope, cutoff, onOpen, onStop, onStopTask }) {
  const turns = group.turns.filter((t) => turnVisible(t, scope, cutoff));
  const c = group.counts;
  return (
    <section className={'activity-group' + (group.live ? ' live' : '')} data-chat={group.chatId}>
      <header>
        <ProviderIcon id={group.provider} small />
        <button className="activity-group-title" onClick={() => onOpen(group.chatId)} title="Abrir este chat">
          <strong>{group.title}</strong>
          <span>
            {PROVIDERS[group.provider]?.name}
            {projectName ? ' · ' + projectName : ''}
          </span>
        </button>
        <span className="activity-group-counts">
          {group.live && <span className="activity-live">Trabalhando</span>}
          {c.running > 0 && <span>{c.running} rodando</span>}
          {c.detached > 0 && <span className="muted">{c.detached} sem acompanhamento</span>}
        </span>
        {group.live && (
          <button
            className="activity-stop"
            onClick={() => onStop(group.chatId)}
            title="Interromper a resposta deste chat"
          >
            <Square size={11} />
            Parar
          </button>
        )}
      </header>
      <div className="task-tree">
        {turns.map((t, i) => (
          <TaskNode
            key={t.messageId}
            node={t.root}
            live={group.live && i === 0}
            onStopTask={onStopTask}
            onOpen={onOpen}
            defaultOpen
          />
        ))}
        {!turns.length && <p className="activity-none">Nada rodando neste chat agora.</p>}
      </div>
    </section>
  );
});

const Chip = ({ id, icon: Icon, n, label }) => (
  <div className={'activity-chip' + (n ? ' hot' : '')} data-kind={id}>
    <Icon size={15} />
    <strong>{n}</strong>
    <span>{label}</span>
  </div>
);

export function ActivityPage({ groups, projects, call, onOpen }) {
  const [scope, setScope] = useState('running'),
    [provider, setProvider] = useState('all'),
    now = useNow(true, 30000);
  const cutoff = Math.floor((now - RECENT_MS) / 60000) * 60000;
  const shown = useMemo(() => filterGroups(groups, { scope, provider, now }), [groups, scope, provider, cutoff]);
  const sum = useMemo(() => summarize(groups), [groups]);
  const projectName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  const onStop = useCallback((chatId) => call('stop', { chatId }).catch(() => {}), [call]);
  const onStopTask = useCallback(
    (t) => call('stopTask', { chatId: t.chatId, taskId: t.taskId }).catch(() => {}),
    [call]
  );
  const used = [...new Set(groups.map((g) => g.provider))];
  return (
    <div className="content-page activity-page">
      <div className="page-heading">
        <div>
          <h1>O que está acontecendo.</h1>
          <p>Todo o trabalho das suas IAs, ao vivo: respostas, subagentes, comandos e tarefas em segundo plano.</p>
        </div>
      </div>
      <div className="activity-summary" role="status">
        <Chip
          id="working"
          icon={Users}
          n={sum.working}
          label={sum.working === 1 ? 'IA trabalhando' : 'IAs trabalhando'}
        />
        <Chip id="subagents" icon={Bot} n={sum.subagents} label={sum.subagents === 1 ? 'subagente' : 'subagentes'} />
        <Chip id="commands" icon={Terminal} n={sum.commands} label={sum.commands === 1 ? 'comando' : 'comandos'} />
        <Chip id="background" icon={Cog} n={sum.background} label="em segundo plano" />
      </div>
      <div className="activity-filters">
        <div className="segmented" role="tablist" aria-label="Escopo">
          {[
            ['running', 'Rodando'],
            ['all', 'Tudo'],
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
        <div className="segmented" role="tablist" aria-label="IA">
          <button
            role="tab"
            aria-selected={provider === 'all'}
            className={provider === 'all' ? 'on' : ''}
            onClick={() => setProvider('all')}
          >
            Todas as IAs
          </button>
          {used.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={provider === id}
              className={provider === id ? 'on' : ''}
              onClick={() => setProvider(id)}
            >
              {PROVIDERS[id]?.name}
            </button>
          ))}
        </div>
        {sum.detached > 0 && (
          <span className="activity-detached" title="Comandos em segundo plano que continuam depois do fim da resposta">
            {sum.detached} sem acompanhamento
          </span>
        )}
      </div>
      <div className="activity-groups">
        {shown.map((g) => (
          <GroupCard
            key={g.chatId}
            group={g}
            projectName={projectName[g.projectId]}
            scope={scope}
            cutoff={cutoff}
            onOpen={onOpen}
            onStop={onStop}
            onStopTask={onStopTask}
          />
        ))}
        {!shown.length && (
          <div className="activity-empty">
            <Activity size={22} />
            <strong>{scope === 'running' ? 'Nenhuma IA trabalhando agora.' : 'Nada nos últimos 30 minutos.'}</strong>
            <span>
              {scope === 'running' ? (
                <>
                  Escolha <em>Tudo</em> para ver o que terminou há pouco.
                </>
              ) : (
                <>
                  <FolderOpen size={12} /> Envie uma mensagem em qualquer chat e o trabalho aparece aqui.
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
