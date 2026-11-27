// Equipes: agents with roles that work together on a project, talking through the wires of a desk. The list of teams,
// the form, and one team open (TeamView). The teams live in the main process (electron/teams).
import { useState } from 'react';
import { Network, Plus } from 'lucide-react';
import { Chapter } from '../Chapter';
import { ProviderIcon } from '../ProviderIcon';
import { TeamForm } from './TeamForm';
import { TeamView } from './TeamView';
import { AskCard } from './TeamTalk';
import { TEAM_STATUS, blankTeam, editableTeam, openAsks, pendingFor } from '../../lib/teams';

export function TeamsPage({ data, integrations, call, setData, notify, onOpenChat }) {
  const teams = data.teams || [];
  const projects = data.projects || [];
  // null (the list), a team id (open), or { draft, id? } (the form).
  const [view, setView] = useState(null);
  const open = typeof view === 'string' ? teams.find((t) => t.id === view) : null;
  const save = async (f) => {
    try {
      if (view.id) {
        setData(await call('teamUpdate', { id: view.id, ...f }));
        setView(view.id);
        notify('Equipe salva');
      } else {
        const r = await call('teamCreate', f);
        setData(r.state);
        setView(r.id);
        notify('Equipe criada');
      }
    } catch {}
  };
  const create = () => setView({ draft: blankTeam(integrations, 'trio', projects[0]?.id || '') });
  // What every team waits on you for, answered right here.
  const pending = pendingFor(teams);
  const answer = async (team, ask, text, decision) => {
    try {
      setData(await call('teamAnswer', { id: team.id, askId: ask.id, text, decision }));
      notify(decision === 'no' ? 'Recusado' : 'Resposta enviada');
      return true;
    } catch {
      return false;
    }
  };

  if (view && typeof view === 'object')
    return (
      <div className="content-page teams-page">
        <TeamForm
          initial={view.draft}
          isNew={!view.id}
          projects={projects}
          integrations={integrations}
          places={data.places || []}
          onSave={save}
          onCancel={() => setView(view.id || null)}
        />
      </div>
    );
  if (open)
    return (
      <div className="teams-page open">
        <TeamView
          key={open.id}
          team={open}
          project={projects.find((p) => p.id === open.projectId)}
          places={data.places || []}
          chats={data.chats || []}
          running={data.running || []}
          call={call}
          setData={setData}
          notify={notify}
          onOpenChat={onOpenChat}
          onBack={() => setView(null)}
          onEdit={() => setView({ id: open.id, draft: editableTeam(open) })}
        />
      </div>
    );
  return (
    <div className="content-page teams-page">
      <div className="page-heading">
        <div>
          <Chapter n={11} title="EQUIPES" />
          <div className="eyebrow">AGENT MODE · EQUIPES</div>
          <h1>Uma equipe de agents num projeto.</h1>
          <p>
            Cada agent tem um papel e uma IA. O líder quebra o objetivo em tarefas, os outros fazem, revisam e conversam
            entre si pelos fios da mesa. Quem edita trabalha na sua própria branch; juntar no projeto espera o seu sim.
          </p>
        </div>
        <button className="primary-button" onClick={create} disabled={!projects.length}>
          <Plus size={16} />
          Nova equipe
        </button>
      </div>
      {!projects.length && <p className="team-note">Adicione um projeto (no Início) para montar uma equipe nele.</p>}
      {pending.length > 0 && (
        <section className="teams-waiting" aria-label="Esperando você">
          <h2>★ ESPERANDO VOCÊ · {pending.length}</h2>
          <div className="teams-waiting-list">
            {pending.map(({ team, ask, member }) => (
              <AskCard
                key={ask.id}
                ask={ask}
                team={team}
                member={member}
                showTeam
                onAnswer={(a, text, decision) => answer(team, a, text, decision)}
              />
            ))}
          </div>
        </section>
      )}
      {teams.length === 0 ? (
        projects.length > 0 && (
          <section className="teams-empty">
            <Network size={22} />
            <h2>Nenhuma equipe ainda.</h2>
            <p>Comece de um modelo: você revisa quem faz o quê antes de criar.</p>
            <button className="primary-button" onClick={create}>
              <Plus size={16} />
              Montar a primeira equipe
            </button>
          </section>
        )
      ) : (
        <div className="teams-grid">
          {teams.map((t) => {
            const asks = openAsks(t).length;
            const working = t.members.filter((m) => m.busy).length;
            return (
              <button
                key={t.id}
                className="team-tile"
                data-team={t.id}
                data-status={t.status}
                onClick={() => setView(t.id)}
              >
                <span className="team-tile-status">
                  {TEAM_STATUS[t.status]}
                  {working > 0 && ' · ' + working + ' trabalhando'}
                  {asks > 0 && <b className="team-tile-waiting">★ {asks} esperando você</b>}
                </span>
                <b>{t.name}</b>
                <small>{projects.find((p) => p.id === t.projectId)?.name || 'Projeto removido'}</small>
                <span className="team-tile-goal">{t.goal}</span>
                <span className="team-tile-members">
                  {t.members.map((m) => (
                    <span key={m.id} title={m.name + ' · ' + m.role}>
                      <ProviderIcon id={m.provider} small />
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
