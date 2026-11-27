// The team's desk: a card per agent (and one for the person), wires between who talks to whom, and every real message
// of the team running along its wire. Cards are dragged (the place is saved when let go); clicking one shows only its
// conversations. The animation is imperative (refs, requestAnimationFrame): a re-render never restarts a message.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { ProviderIcon } from '../ProviderIcon';
import { fmtTokens } from '../../lib/tokens';
import { modelLabel } from '../../lib/format';
import {
  HUMAN,
  KIND_LABELS,
  STATE_LABELS,
  currentTask,
  curve,
  memberState,
  openAsks,
  travels,
  wireKey,
  wiresOf,
  youAt,
} from '../../lib/teams';

const NS = 'http://www.w3.org/2000/svg';
const DUR = 1500;
// After a pause (the screen was closed, the window hidden) only the last ones travel, not a backlog.
const MAX_BURST = 6;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}
// The shape says the kind: task square, question/answer circle, review diamond, the person's yes a star.
function shape(kind, g) {
  if (kind === 'task') return svgEl('rect', { class: 'core', x: -5.5, y: -5.5, width: 11, height: 11 }, g);
  if (kind === 'review') return svgEl('polygon', { class: 'core', points: '0,-7.5 7.5,0 0,7.5 -7.5,0' }, g);
  if (kind === 'human')
    return svgEl(
      'polygon',
      { class: 'core', points: '0,-8 2.3,-3 7.6,-2.5 3.6,1.2 4.7,6.5 0,3.8 -4.7,6.5 -3.6,1.2 -7.6,-2.5 -2.3,-3' },
      g
    );
  return svgEl('circle', { class: 'core', r: 5.5 }, g);
}

export function TeamStage({ team, places = [], focus, onFocus, onPlace, onAnswer, onOpenChat, ahead, onMerge }) {
  const stage = useRef(null);
  const svg = useRef(null);
  const cards = useRef({});
  const wires = useRef({});
  const seen = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Places while dragging stay local; the saved ones come back with the team.
  const saved = () => ({
    [HUMAN]: youAt(team),
    ...Object.fromEntries(team.members.map((m) => [m.id, { x: m.x, y: m.y }])),
  });
  const [pos, setPos] = useState(saved);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setPos(saved());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the places only change with the saved team
  }, [team]);
  useLayoutEffect(() => {
    const el = stage.current;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const center = (id) => [(pos[id]?.x ?? 0.5) * size.w, (pos[id]?.y ?? 0.5) * size.h];
  const pairs = wiresOf(team);

  // ---- messages on the wires --------------------------------------------------------------------------------------
  function heat(w, from) {
    w.live = (w.live || 0) + 1;
    w.g.classList.add('hot');
    w.g.classList.toggle('rev', w.a !== from);
  }
  function cool(w) {
    w.live = Math.max(0, w.live - 1);
    const stamp = (w.cooling = Symbol());
    setTimeout(() => {
      if (w.cooling === stamp && !w.live) {
        w.g.classList.remove('hot', 'rev');
        if (w.tag) w.tag.textContent = '';
      }
    }, 1800);
  }
  function arrive(msg) {
    const card = cards.current[msg.to];
    if (!card) return;
    card.classList.remove('got');
    void card.offsetWidth;
    card.classList.add('got');
    const b = card.querySelector('.team-bubble');
    if (!b) return;
    b.querySelector('small').textContent = KIND_LABELS[msg.kind] || '';
    b.querySelector('span').textContent = msg.text.length > 90 ? msg.text.slice(0, 88) + '…' : msg.text;
    b.classList.add('on');
    clearTimeout(b.timer);
    b.timer = setTimeout(() => b.classList.remove('on'), 3200);
  }
  function travel(msg) {
    const w = wires.current[wireKey(msg.from, msg.to)];
    if (!w?.base || !svg.current) return arrive(msg);
    heat(w, msg.from);
    if (w.tag) w.tag.textContent = msg.kind === 'ask' || msg.kind === 'answer' ? 'conversando' : KIND_LABELS[msg.kind];
    const back = w.a !== msg.from;
    // Hidden until the first frame puts it on the wire (else it flashes in the corner of the desk).
    const g = svgEl('g', { class: 'team-packet', visibility: 'hidden', 'data-kind': msg.kind }, svg.current);
    const trail = [0, 1, 2, 3, 4, 5].map((i) =>
      svgEl('circle', { class: 'trail', r: 3.6 - i * 0.5, opacity: 0.55 - i * 0.09 }, g)
    );
    const halo = svgEl('circle', { class: 'halo', r: 11 }, g);
    const core = shape(msg.kind, g);
    const start = performance.now();
    // The wire is read on every frame: dragging a card mid-way takes the message along.
    const at = (d) => {
      const len = w.base.getTotalLength();
      return w.base.getPointAtLength(Math.min(len, Math.max(0, back ? len * (1 - d) : len * d)));
    };
    const frame = (t) => {
      const e = reduced() ? 1 : Math.min(1, (t - start) / DUR);
      const ease = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
      const pt = at(ease);
      core.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')');
      halo.setAttribute('cx', pt.x);
      halo.setAttribute('cy', pt.y);
      halo.setAttribute('r', 9 + Math.sin(t / 90) * 2.5);
      trail.forEach((c, i) => {
        const q = at(Math.max(0, ease - (i + 1) * 0.028));
        c.setAttribute('cx', q.x);
        c.setAttribute('cy', q.y);
      });
      g.removeAttribute('visibility');
      if (e < 1 && g.isConnected) return requestAnimationFrame(frame);
      g.remove();
      cool(w);
      arrive(msg);
    };
    requestAnimationFrame(frame);
  }
  // New messages since the last render travel; the ones already there when the desk opened do not.
  useEffect(() => {
    const msgs = team.messages || [];
    if (!seen.current) {
      seen.current = new Set(msgs.map((m) => m.id));
      return;
    }
    if (!size.w) return;
    const fresh = msgs.filter((m) => !seen.current.has(m.id));
    for (const m of fresh) seen.current.add(m.id);
    fresh
      .filter(travels)
      .slice(-MAX_BURST)
      .forEach((m, i) => setTimeout(() => travel(m), i * 350));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per batch of messages
  }, [team.messages, size.w]);

  // ---- dragging ----------------------------------------------------------------------------------------------------
  function drag(e, id) {
    if (e.button !== 0 || e.target.closest('button, input, textarea')) return;
    const card = e.currentTarget;
    const r = stage.current.getBoundingClientRect();
    const sx = e.clientX,
      sy = e.clientY;
    const ox = (pos[id]?.x ?? 0.5) * r.width,
      oy = (pos[id]?.y ?? 0.5) * r.height;
    let moved = false;
    let last = pos;
    card.setPointerCapture?.(e.pointerId);
    dragging.current = true;
    card.classList.add('dragging');
    const move = (ev) => {
      const dx = ev.clientX - sx,
        dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const p = {
        x: Math.min(0.95, Math.max(0.05, (ox + dx) / r.width)),
        y: Math.min(0.93, Math.max(0.07, (oy + dy) / r.height)),
      };
      setPos((x) => (last = { ...x, [id]: p }));
    };
    const up = () => {
      card.classList.remove('dragging');
      card.removeEventListener('pointermove', move);
      dragging.current = false;
      if (moved) onPlace(last);
      else onFocus(focus === id ? null : id);
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', up, { once: true });
  }

  const near = (id) =>
    !focus || id === focus || pairs.some(([a, b]) => (a === focus && b === id) || (b === focus && a === id));
  const asks = openAsks(team);
  const style = (id) => ({ left: center(id)[0] + 'px', top: center(id)[1] + 'px' });

  return (
    <section className="team-stage" ref={stage} aria-label="Mesa da equipe">
      <span className="team-stage-label">// MESA · OS FIOS SÃO QUEM CONVERSA COM QUEM</span>
      <svg className="team-wires" ref={svg} aria-hidden="true">
        {size.w > 0 &&
          pairs.map(([a, b]) => {
            const key = wireKey(a, b);
            const d = curve(center(a), center(b));
            return (
              <g
                key={key}
                data-wire={key}
                className={'team-wire' + (focus && a !== focus && b !== focus ? ' dim' : '')}
                ref={(g) => {
                  if (!g) return; // kept: a re-render must not lose a wire that is carrying a message
                  const w = (wires.current[key] ||= {});
                  Object.assign(w, { g, a, base: g.querySelector('.base'), tag: g.querySelector('.wire-tag') });
                }}
              >
                <path className="glow" d={d} />
                <path className="base" d={d} />
                <WireTag d={d} />
              </g>
            );
          })}
      </svg>
      <div className="team-legend" aria-label="Legenda">
        <span>
          <svg viewBox="0 0 14 14">
            <rect x="3" y="3" width="8" height="8" />
          </svg>
          tarefa
        </span>
        <span>
          <svg viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="4.5" />
          </svg>
          pergunta / resposta
        </span>
        <span>
          <svg viewBox="0 0 14 14">
            <path d="M7 1.5L12.5 7 7 12.5 1.5 7z" />
          </svg>
          revisão
        </span>
        <span>
          <svg viewBox="0 0 14 14">
            <path d="M7 1l1.8 4 4.2.4-3.2 2.8 1 4.2L7 10.2 3.2 12.4l1-4.2L1 5.4l4.2-.4z" />
          </svg>
          pede o seu sim
        </span>
      </div>

      <article
        className={'team-card you' + (focus === HUMAN ? ' sel' : '') + (near(HUMAN) ? '' : ' dim')}
        data-agent={HUMAN}
        data-state={asks.length ? 'waiting' : 'idle'}
        ref={(el) => (cards.current[HUMAN] = el)}
        style={style(HUMAN)}
        onPointerDown={(e) => drag(e, HUMAN)}
      >
        <Bubble />
        <div className="team-card-head">
          <span className="team-ai you" aria-hidden="true" />
          <div>
            <div className="team-card-name">Você</div>
            <div className="team-card-role">aprova e decide</div>
          </div>
        </div>
        <div className="team-card-body">
          <div className="team-state">
            <span className="dot" />
            {asks.length ? 'Esperando você' + (asks.length > 1 ? ' (' + asks.length + ')' : '') : 'Nada esperando'}
          </div>
          {asks[0] && <Ask key={asks[0].id} team={team} ask={asks[0]} onAnswer={onAnswer} />}
        </div>
      </article>

      {team.members.map((m) => {
        const state = memberState(team, m);
        const task = currentTask(team, m.id);
        const n = ahead?.[m.id] || 0;
        const vps =
          m.place && m.place !== 'pc' ? places.find((p) => p.id === m.place) || { name: 'lugar esquecido' } : null;
        return (
          <article
            key={m.id}
            className={'team-card' + (focus === m.id ? ' sel' : '') + (near(m.id) ? '' : ' dim')}
            data-agent={m.id}
            data-state={state}
            tabIndex={0}
            aria-label={m.name + ', ' + m.role + ', ' + STATE_LABELS[state]}
            ref={(el) => (cards.current[m.id] = el)}
            style={style(m.id)}
            onPointerDown={(e) => drag(e, m.id)}
            onKeyDown={(e) => e.key === 'Enter' && onFocus(focus === m.id ? null : m.id)}
          >
            <Bubble />
            <div className="team-card-head">
              <ProviderIcon id={m.provider} small />
              <div>
                <div className="team-card-name">
                  {m.name}
                  {m.lead && <small>líder</small>}
                </div>
                <div className="team-card-role">
                  {m.role}
                  {m.model ? ' · ' + modelLabel(m.model) : ''}
                </div>
              </div>
              {m.chatId && (
                <button
                  className="team-card-open"
                  title={'Abrir o chat de ' + m.name}
                  aria-label={'Abrir o chat de ' + m.name}
                  onClick={() => onOpenChat(m.chatId)}
                >
                  <MessageSquare size={13} />
                </button>
              )}
            </div>
            <div className="team-card-body">
              <div className="team-state">
                <span className="dot" />
                {STATE_LABELS[state]}
                {m.mode === 'read' && <span className="team-mode">só lê</span>}
              </div>
              <div className="team-task">{task ? task.id + ' · ' + task.title : m.lastLine || ''}</div>
              <div className="team-meta">
                <span>{fmtTokens(m.tokens || 0)} tokens</span>
                {m.branch && <span title={m.branch}>{m.branch.split('/').pop()}</span>}
                {vps && (
                  <span className={'team-place' + (vps.online === false ? ' off' : '')} data-place={m.place}>
                    {vps.online === false ? '✕ ' : ''}
                    {vps.name}
                  </span>
                )}
              </div>
              {n > 0 && (
                <button className="team-merge" onClick={() => onMerge(m)} title={'Juntar ' + m.branch + ' no projeto'}>
                  Juntar {n} commit{n === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function Bubble() {
  return (
    <div className="team-bubble" aria-hidden="true">
      <small />
      <span />
    </div>
  );
}

// The middle of the wire holds its tag ("conversando", "revisão"); placed once the path is in the page.
function WireTag({ d }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const base = ref.current?.parentNode?.querySelector('.base');
    if (!base?.getTotalLength) return;
    const p = base.getPointAtLength(base.getTotalLength() / 2);
    ref.current.setAttribute('x', p.x);
    ref.current.setAttribute('y', p.y - 8);
  }, [d]);
  return <text ref={ref} className="wire-tag" textAnchor="middle" />;
}

// What an agent asked the person: quick yes/no, or a written answer.
function Ask({ team, ask, onAnswer }) {
  const [text, setText] = useState('');
  const who = team.members.find((m) => m.id === ask.from)?.name || 'Um agent';
  return (
    <div className="team-ask">
      <p>
        <b>{who}:</b> {ask.text}
      </p>
      <div className="team-ask-row">
        <button className="ink" onClick={() => onAnswer(ask, 'Sim, pode.')}>
          Sim
        </button>
        <button onClick={() => onAnswer(ask, 'Ainda não.')}>Ainda não</button>
      </div>
      <form
        className="team-ask-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onAnswer(ask, text.trim());
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ou responda com suas palavras"
          aria-label={'Responder a ' + who}
        />
      </form>
    </div>
  );
}
