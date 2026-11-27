// One team: its header (goal, counts, today's tokens, start/pause/stop), the desk with the wires and, beside it, the
// conversations and the board. Everything the team does comes from the main process (electron/teams); this screen
// only calls its methods.
import { useEffect, useState } from 'react';
import { ArrowLeft, Pause, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { TeamStage } from './TeamStage';
import { TeamSide } from './TeamSide';
import { TeamTalk } from './TeamTalk';
import { fmtTokens } from '../../lib/tokens';
import { TEAM_STATUS, placesOf, spentToday, teamCounts } from '../../lib/teams';

export function TeamView({
  team,
  project,
  places = [],
  chats = [],
  running = [],
  call,
  setData,
  notify,
  onBack,
  onEdit,
  onOpenChat,
}) {
  const [focus, setFocus] = useState(null);
  const [ahead, setAhead] = useState({});
  // The conversation sheet: null (closed), 'voce' (what waits on you) or a member id.
  const [talk, setTalk] = useState(null);
  const [busy, setBusy] = useState(false);
  const counts = teamCounts(team);
  const spent = spentToday(team, Date.now());
  const branched = team.members.some((m) => m.branch);
  // Commits waiting to be joined, per agent: asked again whenever the team changes.
  useEffect(() => {
    if (!branched) return;
    let live = true;
    call('teamBranches', { id: team.id })
      .then((r) => live && setAhead(r || {}))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per change of the team
  }, [team.updatedAt, branched]);

  const act = async (method, args = {}, message) => {
    setBusy(true);
    try {
      const r = await call(method, { id: team.id, ...args });
      setData(r.state || r);
      if (message) notify(message);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };
  const answer = (ask, text, decision) =>
    act('teamAnswer', { askId: ask.id, text, decision }, decision === 'no' ? 'Recusado' : 'Resposta enviada');
  const working = team.status === 'running';
  const fresh = !(team.messages || []).some((m) => m.kind !== 'note');
  // Where it runs: the place of most members, and how many are elsewhere.
  const placeName = (id) => (id === 'pc' ? 'Este PC' : places.find((p) => p.id === id)?.name || 'lugar esquecido');
  const offline = (id) => id !== 'pc' && places.find((p) => p.id === id)?.online === false;
  const [home, ...rest] = placesOf(team);

  return (
    <div className="team-view" data-team={team.id} data-status={team.status}>
      <header className="team-head">
        <div className="team-head-main">
          <button className="team-back" onClick={onBack}>
            <ArrowLeft size={14} />
            Equipes
          </button>
          <div className="team-kicker">AGENT MODE · EQUIPE · {TEAM_STATUS[team.status].toUpperCase()}</div>
          <h1>{team.name}</h1>
          <p className="team-goal">
            <b>{project?.name || 'Projeto removido'}</b> · {team.goal}
          </p>
        </div>
        <div className="team-head-right">
          {/* Where the team runs: VeSTA carries the turns; a member on a VPS runs there (Onde rodam). */}
          <span
            className={'team-chip team-where' + (offline(home.place) ? ' off' : '')}
            data-where={home.place}
            title="O VeSTA aberto leva as mensagens da equipe; quem está numa VPS roda lá"
          >
            <i />
            <span>
              Roda em <b>{placeName(home.place)}</b>
              {home.place === 'pc' ? ' · VeSTA aberto' : ''}
            </span>
          </span>
          {rest.map((r) => (
            <span
              key={r.place}
              className={'team-chip team-where' + (offline(r.place) ? ' off' : '')}
              data-where={r.place}
            >
              +{r.count} agent{r.count > 1 ? 's' : ''} em <b>{placeName(r.place)}</b>
              {offline(r.place) ? ' · fora do ar' : ''}
            </span>
          ))}
          <span className="team-chip" data-counts>
            <b>{counts.working}</b> trabalhando · <b>{counts.agents}</b> agents
          </span>
          <div className="team-budget" aria-label="Tokens de hoje">
            <span>
              Hoje: {fmtTokens(spent)}
              {team.budget > 0 ? ' de ' + fmtTokens(team.budget) : ''} tokens
            </span>
            {team.budget > 0 && (
              <div className="team-budget-track">
                <div className="team-budget-fill" style={{ width: Math.min(100, (spent / team.budget) * 100) + '%' }} />
              </div>
            )}
          </div>
          {counts.waiting > 0 && (
            <button className="team-waiting" data-action="waiting-head" onClick={() => setTalk('voce')}>
              ★ {counts.waiting} esperando você
            </button>
          )}
          {working ? (
            <button className="team-btn" disabled={busy} onClick={() => act('teamPause', {}, 'Equipe pausada')}>
              <Pause size={14} />
              Pausar a equipe
            </button>
          ) : (
            <button
              className="team-btn ink"
              data-action="start"
              disabled={busy}
              onClick={() => act('teamStart', {}, fresh ? 'A equipe começou' : 'A equipe continuou')}
            >
              <Play size={14} />
              {fresh ? 'Começar' : 'Continuar'}
            </button>
          )}
          <button
            className="team-btn"
            data-action="stop"
            disabled={busy || team.status === 'stopped' || team.status === 'idle'}
            onClick={() => act('teamStop', {}, 'Todos os agents pararam')}
          >
            <Square size={14} />
            Parar todos
          </button>
          <button className="team-btn icon" title="Editar a equipe" aria-label="Editar a equipe" onClick={onEdit}>
            <Pencil size={14} />
          </button>
          <button
            className="team-btn icon"
            title="Apagar a equipe"
            aria-label="Apagar a equipe"
            disabled={busy}
            onClick={async () => {
              if (
                window.confirm(
                  'Apagar a equipe "' + team.name + '"? Os chats voltam para Conversas e as branches ficam no projeto.'
                )
              )
                if (await act('teamRemove', {}, 'Equipe apagada')) onBack();
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="team-body">
        <div className="team-desk">
          <TeamStage
            team={team}
            places={places}
            focus={focus}
            onFocus={setFocus}
            ahead={ahead}
            onTalk={setTalk}
            onPlace={(positions) => act('teamPlace', { positions })}
            onMerge={(m) => act('teamMerge', { memberId: m.id }, m.branch + ' juntada no projeto')}
          />
          <TeamTalk
            team={team}
            chats={chats}
            running={running}
            tab={talk}
            onTab={setTalk}
            onSay={(to, text) => act('teamSay', { to, text })}
            onAnswer={answer}
            onOpenChat={onOpenChat}
          />
        </div>
        <TeamSide team={team} focus={focus} onFocus={setFocus} />
      </div>
    </div>
  );
}
