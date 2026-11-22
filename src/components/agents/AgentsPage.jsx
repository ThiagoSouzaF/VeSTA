// Agent Mode: every agent at a glance (the numbers, today's lanes, the cards) and one agent in a drawer. The agents
// live in the main process (electron/agents); this screen only calls its methods.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Sparkles } from 'lucide-react';
import { Chapter } from '../Chapter';
import { TabInk } from '../TabInk';
import { usePresence, EXIT } from '../../hooks/usePresence';
import { AgentCard } from './AgentCard';
import { AgentDrawer } from './AgentDrawer';
import { AgentTimeline } from './AgentTimeline';
import { blankAgent } from './AgentForm';
import { FILTERS, TEMPLATES, describeSchedule, filterAgents, nextUp, statusOf, untilLabel } from '../../lib/agents';

// Relative times ("em 25 min") stay true while the screen is open.
function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function AgentsPage({ data, integrations, call, setData, notify, onOpenChat }) {
  const agents = data.agents || [];
  const now = useNow();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  // The drawer: an agent id, or { draft } for a new one.
  const [open, setOpen] = useState(null);
  const current = typeof open === 'string' ? agents.find((a) => a.id === open) || null : open;
  const [drawn, drawerState] = usePresence(current, EXIT.panel);
  // Opening the screen marks the finished runs as seen (the rail badge goes away).
  const unseen = agents.some((a) => a.unseen);
  useEffect(() => {
    if (unseen)
      call('agentSeen')
        .then(setData)
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per batch of new results
  }, [unseen]);

  const statuses = useMemo(() => agents.map((a) => statusOf(a, data.chats)), [agents, data.chats]);
  const count = (s) => statuses.filter((x) => x === s).length;
  const active = agents.filter((a) => a.enabled).length;
  const next = nextUp(agents);
  const shown = filterAgents(agents, { filter, query });
  const create = (template = {}) => setOpen({ draft: { ...blankAgent(integrations), ...template } });
  const act = async (method, args, message) => {
    try {
      const r = await call(method, args);
      setData(r.state || r);
      if (message) notify(message);
    } catch {}
  };
  const TABS = FILTERS.map(([id, label]) => [
    id,
    label,
    id === 'all' ? agents.length : id === 'on' ? active : agents.length - active,
  ]);

  return (
    <div className="content-page agents-page">
      <div className="page-heading">
        <div>
          <Chapter n={10} title="AGENT MODE" />
          <div className="eyebrow">AGENT MODE</div>
          <h1>Trabalham enquanto você não está.</h1>
          <p>
            Cada agent é um pedido com nome que uma IA cumpre sozinha, na hora marcada ou quando você pedir, com a
            memória e as skills do VeSTA. Tudo o que fazem fica no diário de cada um.
          </p>
        </div>
        <button className="primary-button" onClick={() => create()}>
          <Plus size={16} />
          Novo agent
        </button>
      </div>

      {agents.length === 0 ? (
        <section className="agents-empty">
          <Sparkles size={22} />
          <h2>Nenhum agent ainda.</h2>
          <p>Comece do zero ou de um destes. Você revisa tudo antes de ligar.</p>
          <div className="agents-templates">
            {TEMPLATES.map((t) => (
              <button key={t.name} className="agent-template" onClick={() => create(t)} data-template={t.name}>
                <b>{t.name}</b>
                <span>{describeSchedule(t.schedule)}</span>
                <small>{t.prompt}</small>
              </button>
            ))}
            <button className="agent-template blank" onClick={() => create()}>
              <Plus size={18} />
              <b>Em branco</b>
            </button>
          </div>
          <p className="agent-note">
            Os agents rodam com o VeSTA aberto, mesmo minimizado. Fechado na hora marcada, o agent roda uma vez quando
            você abrir (se quiser).
          </p>
        </section>
      ) : (
        <>
          <div className="agents-strip" aria-label="Resumo dos agents">
            <span>
              <b>{active}</b> ativo{active === 1 ? '' : 's'}
            </span>
            <span className={count('running') ? 'live' : ''}>
              <b>{count('running')}</b> rodando agora
            </span>
            <span className={count('waiting') ? 'attention' : ''}>
              <b>{count('waiting')}</b> esperando você
            </span>
            <span>
              <b>{count('error')}</b> com falha na última
            </span>
            <span className="agents-next">
              {next ? (
                <>
                  Próximo: <b>{next.name}</b> {untilLabel(next.nextRunAt, now)}
                </>
              ) : (
                'Nenhum agendado'
              )}
            </span>
          </div>

          <AgentTimeline agents={agents} now={now} selected={current?.id} onSelect={setOpen} />

          <div className="agents-bar">
            <div className="agents-tabs tab-ink-host" role="tablist" aria-label="Filtrar agents">
              {TABS.map(([id, label, n]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={filter === id}
                  data-filter={id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                  <span className="skills-n">{n}</span>
                </button>
              ))}
              <TabInk active="[aria-selected='true']" value={filter} />
            </div>
            <label className="skills-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar pelo nome ou pelo pedido"
                aria-label="Buscar agent"
              />
            </label>
          </div>

          <div className="agent-grid">
            {shown.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                chats={data.chats}
                projects={data.projects}
                now={now}
                selected={current?.id === a.id}
                onOpen={setOpen}
                onToggle={(x, on) =>
                  act('agentToggle', { id: x.id, enabled: on }, x.name + (on ? ' ativo' : ' inativo'))
                }
                onRun={(x) => act('agentRun', { id: x.id }, x.name + ' começou')}
              />
            ))}
            <button className="agent-card add" onClick={() => create()}>
              <Plus size={20} />
              Novo agent
            </button>
          </div>
          {!shown.length && (
            <p className="agent-empty-line">
              Nenhum agent {filter === 'on' ? 'ativo' : filter === 'off' ? 'inativo' : ''}
              {query ? ' com “' + query + '”' : ''}.
            </p>
          )}
        </>
      )}

      {drawn && (
        <AgentDrawer
          key={drawn.id || 'new'}
          agent={drawn.id ? drawn : null}
          draft={drawn.draft}
          state={drawerState}
          data={data}
          integrations={integrations}
          now={now}
          call={call}
          setData={setData}
          notify={notify}
          onClose={() => setOpen(null)}
          onCreated={(id) => setOpen(id)}
          onOpenChat={onOpenChat}
        />
      )}
    </div>
  );
}
