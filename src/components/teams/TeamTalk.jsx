// Talking with the team: a bar under the desk that opens, from the bottom up, a large conversation with each agent —
// the messages between you and it and what it really answered on each turn in its chat (the same text as the normal
// chat, which one click opens) — and the "Esperando você" tab: everything an agent waits on you for, answered here
// (Aceitar / Recusar for a yes, words for a question). AskCard is also used on the Equipes list.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, MessageSquare, X } from 'lucide-react';
import { ProviderIcon } from '../ProviderIcon';
import { Markdown } from '../Markdown';
import {
  HUMAN,
  KIND_LABELS,
  STATE_LABELS,
  decisionText,
  hhmm,
  memberState,
  openAsks,
  talkWith,
  yesNo,
} from '../../lib/teams';

// One thing an agent waits on you for. onAnswer(ask, text, decision).
export function AskCard({ ask, member, team, showTeam = false, onAnswer }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const who = member?.name || 'Um agent';
  const send = async (reply, decision = null) => {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      await onAnswer(ask, reply.trim(), decision);
    } finally {
      setSending(false);
    }
  };
  const asksYes = yesNo(ask);
  return (
    <article className="team-ask-card" data-ask={ask.id} data-kind={asksYes ? 'yes' : 'question'}>
      <header>
        {member && <ProviderIcon id={member.provider} small />}
        <b>{who}</b>
        <span className="kind">{asksYes ? 'pede o seu sim' : 'pergunta'}</span>
        {showTeam && <span className="team-ask-team">{team.name}</span>}
        <time>{hhmm(ask.at)}</time>
      </header>
      <p>{ask.text}</p>
      <textarea
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        placeholder={asksYes ? 'Um motivo ou um ajuste (opcional)' : 'Sua resposta'}
        aria-label={'Responder a ' + who}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !asksYes) {
            e.preventDefault();
            send(text);
          }
        }}
      />
      <div className="team-ask-actions">
        {asksYes ? (
          <>
            <button className="ink" disabled={sending} onClick={() => send(decisionText('yes', text), 'yes')}>
              Aceitar
            </button>
            <button disabled={sending} onClick={() => send(decisionText('no', text), 'no')}>
              Recusar
            </button>
          </>
        ) : (
          <>
            <button className="ink" disabled={sending || !text.trim()} onClick={() => send(text)}>
              Responder
            </button>
            <button disabled={sending} onClick={() => send('Sim.', 'yes')}>
              Sim
            </button>
            <button disabled={sending} onClick={() => send('Não.', 'no')}>
              Não
            </button>
          </>
        )}
      </div>
    </article>
  );
}

// tab: 'voce' (what waits on you) or a member id; null = closed.
export function TeamTalk({ team, chats = [], running = [], tab, onTab, onSay, onAnswer, onOpenChat }) {
  const asks = openAsks(team);
  const open = tab != null;
  useEffect(() => {
    if (!open) return;
    const esc = (e) => e.key === 'Escape' && onTab(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onTab]);
  const lead = team.members.find((m) => m.lead) || team.members[0];
  return (
    <>
      <div className="team-talk-bar">
        <button className="team-talk-open" data-action="talk" onClick={() => onTab(lead.id)}>
          <MessageSquare size={15} />
          Conversar com a equipe
          <small>a conversa de cada agent, grande</small>
        </button>
        {asks.length > 0 && (
          <button className="team-waiting" data-action="waiting" onClick={() => onTab(HUMAN)}>
            ★ {asks.length} esperando você
          </button>
        )}
      </div>
      <section className={'team-talk' + (open ? ' open' : '')} aria-hidden={!open} aria-label="Conversa com a equipe">
        {open && (
          <>
            <header className="team-talk-head">
              <div className="team-talk-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={tab === HUMAN}
                  data-tab={HUMAN}
                  className={asks.length ? 'waiting' : ''}
                  onClick={() => onTab(HUMAN)}
                >
                  Esperando você <span className="n">{asks.length}</span>
                </button>
                {team.members.map((m) => {
                  const st = memberState(team, m);
                  return (
                    <button
                      key={m.id}
                      role="tab"
                      aria-selected={tab === m.id}
                      data-tab={m.id}
                      data-state={st}
                      title={STATE_LABELS[st]}
                      onClick={() => onTab(m.id)}
                    >
                      <ProviderIcon id={m.provider} small />
                      {m.name}
                      <i className="dot" />
                    </button>
                  );
                })}
              </div>
              <button className="team-talk-close" aria-label="Fechar a conversa" onClick={() => onTab(null)}>
                <X size={16} />
              </button>
            </header>
            {tab === HUMAN ? (
              <div className="team-talk-waiting">
                {asks.length ? (
                  asks.map((a) => (
                    <AskCard
                      key={a.id}
                      ask={a}
                      team={team}
                      member={team.members.find((m) => m.id === a.from)}
                      onAnswer={onAnswer}
                    />
                  ))
                ) : (
                  <p className="team-empty">
                    Nada esperando você. Quando um agent pedir o seu sim ou perguntar algo, aparece aqui.
                  </p>
                )}
              </div>
            ) : (
              <Thread
                key={tab}
                team={team}
                member={team.members.find((m) => m.id === tab) || lead}
                chats={chats}
                running={running}
                onSay={onSay}
                onAnswer={onAnswer}
                onOpenChat={onOpenChat}
              />
            )}
          </>
        )}
      </section>
    </>
  );
}

function Thread({ team, member, chats, running, onSay, onAnswer, onOpenChat }) {
  const chat = member.chatId ? chats.find((c) => c.id === member.chatId) : null;
  const items = talkWith(team, member.id, chat, running);
  const ask = openAsks(team).find((a) => a.from === member.id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const log = useRef(null);
  const last = items.length ? items[items.length - 1].id + ':' + items[items.length - 1].text.length : '';
  useLayoutEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [last]);
  const send = async (reply = text, decision = null) => {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      const ok = ask ? await onAnswer(ask, reply.trim(), decision) : await onSay(member.id, reply.trim());
      if (ok !== false) setText('');
    } finally {
      setSending(false);
    }
  };
  const remote = member.place && member.place !== 'pc';
  return (
    <div className="team-talk-thread" data-member={member.id}>
      <div className="team-talk-who">
        <span>
          <b>{member.name}</b> · {member.role}
        </span>
        {chat ? (
          <button className="team-btn" onClick={() => onOpenChat(chat.id)}>
            <ExternalLink size={13} />
            Abrir no chat normal
          </button>
        ) : (
          <small>{remote ? 'roda numa VPS: sem chat neste PC' : 'ainda sem chat: começa no primeiro turno'}</small>
        )}
      </div>
      <div className="team-talk-log" ref={log} aria-live="polite">
        {!items.length && (
          <p className="team-empty">
            Nada entre vocês ainda. Escreva abaixo: {member.name} acorda com a sua mensagem quando a equipe rodar.
          </p>
        )}
        {items.map((it) =>
          it.side === 'turn' ? (
            <div key={it.id} className="team-talk-turn" data-live={it.live || undefined}>
              <small>
                {hhmm(it.at)} · resposta do turno{it.live ? ' · escrevendo…' : ''}
              </small>
              <Markdown text={it.text} />
            </div>
          ) : (
            <div key={it.id} className={'team-talk-msg ' + it.side} data-kind={it.kind}>
              <small>
                {hhmm(it.at)} · {it.side === 'you' ? 'você' : member.name} · {KIND_LABELS[it.kind]}
              </small>
              <p>
                {it.held && <span className="team-held">na fila: lugar fora do ar</span>}
                {it.text}
              </p>
            </div>
          )
        )}
        {remote && member.lastReply && (
          <div className="team-talk-turn">
            <small>última resposta na VPS</small>
            <Markdown text={member.lastReply} />
          </div>
        )}
      </div>
      <form
        className="team-talk-compose"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {ask && (
          <div className="team-talk-asking">
            <span>
              <b>{member.name}</b> espera você: {ask.text}
            </span>
            {yesNo(ask) && (
              <>
                <button
                  type="button"
                  className="ink"
                  disabled={sending}
                  onClick={() => send(decisionText('yes', text), 'yes')}
                >
                  Aceitar
                </button>
                <button type="button" disabled={sending} onClick={() => send(decisionText('no', text), 'no')}>
                  Recusar
                </button>
              </>
            )}
          </div>
        )}
        <textarea
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            ask
              ? 'Sua resposta para ' + member.name
              : 'Mensagem para ' + member.name + ' (Enter envia, Shift+Enter quebra a linha)'
          }
          aria-label={'Mensagem para ' + member.name}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="team-btn ink" disabled={!text.trim() || sending} data-action="send">
          {ask ? 'Responder' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
