// One team: its header (goal, counts, today's tokens, start/pause/stop), the desk with the wires and, beside it, the
// conversations and the board. Everything the team does comes from the main process (electron/teams); this screen
// only calls its methods.
import { useEffect, useState } from 'react';
import { ArrowLeft, Pause, Pencil, Play, Send, Square, Trash2 } from 'lucide-react';
import { TeamStage } from './TeamStage';
import { TeamSide } from './TeamSide';
import { fmtTokens } from '../../lib/tokens';
import { TEAM_STATUS, leadOf, spentToday, teamCounts } from '../../lib/teams';

export function TeamView({ team, project, call, setData, notify, onBack, onEdit, onOpenChat }) {
  const [focus, setFocus] = useState(null);
  const [ahead, setAhead] = useState({});
  const [to, setTo] = useState(leadOf(team).id);
  const [text, setText] = useState('');
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
  const running = team.status === 'running';
  const fresh = !(team.messages || []).some((m) => m.kind !== 'note');

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
          <span className="team-chip" data-counts>
            <b>{counts.working}</b> trabalhando · <b>{counts.agents}</b> agents
            {counts.waiting > 0 && (
              <>
                {' '}
                · <b>esperando você</b>
              </>
            )}
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
          {running ? (
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
            focus={focus}
            onFocus={setFocus}
            ahead={ahead}
            onOpenChat={onOpenChat}
            onPlace={(positions) => act('teamPlace', { positions })}
            onAnswer={(ask, reply) => act('teamAnswer', { askId: ask.id, text: reply }, 'Resposta enviada')}
            onMerge={(m) => act('teamMerge', { memberId: m.id }, m.branch + ' juntada no projeto')}
          />
          <form
            className="team-say"
            onSubmit={async (e) => {
              e.preventDefault();
              if (text.trim() && (await act('teamSay', { to, text: text.trim() }))) setText('');
            }}
          >
            <span>Falar com</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Para quem">
              {team.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={running ? 'Uma mensagem; o agent acorda com ela' : 'Uma mensagem para quando a equipe rodar'}
              aria-label="Mensagem para o agent"
            />
            <button className="team-btn" disabled={!text.trim() || busy} aria-label="Enviar">
              <Send size={14} />
            </button>
          </form>
        </div>
        <TeamSide team={team} focus={focus} onFocus={setFocus} />
      </div>
    </div>
  );
}
