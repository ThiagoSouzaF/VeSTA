// Mapa: every place side by side (lib/places mapModel). This PC holds "VeSTA aberto" — you, the teams (dashed frames,
// with the wires of each desk) and the agents not installed anywhere — and the agents of its scheduler; each VPS holds
// its own. A thick wire joins you to each VPS: VeSTA reads it over SSH, and an offline one cuts it. What really happens
// travels: each new team message along its wire, each run that comes back from a place from its card to you.
// The thick wire joins the headers of this PC (where VeSTA runs) and of each VPS.
// The animation is imperative (refs, requestAnimationFrame), so a re-render never restarts a packet.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ProviderIcon } from '../ProviderIcon';
import { agoLabel } from '../../lib/agents';
import { mapModel } from '../../lib/places';

const NS = 'http://www.w3.org/2000/svg';
const MAX_BURST = 6;
const KIND = {
  task: 'tarefa',
  ask: 'pergunta',
  answer: 'resposta',
  review: 'revisão',
  human: 'seu sim',
  error: 'falha',
};
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const svgEl = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};
// A soft curve between two points and its middle (for the wire's tag).
function curve([x1, y1], [x2, y2]) {
  const dx = x2 - x1,
    dy = y2 - y1;
  const vertical = Math.abs(dy) > Math.abs(dx) * 0.6;
  const c1 = vertical ? [x1, y1 + dy * 0.5] : [x1 + dx * 0.5, y1];
  const c2 = vertical ? [x2, y2 - dy * 0.5] : [x2 - dx * 0.5, y2];
  return {
    d: `M${x1},${y1} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}`,
    mid: [(x1 + 3 * c1[0] + 3 * c2[0] + x2) / 8, (y1 + 3 * c1[1] + 3 * c2[1] + y2) / 8],
  };
}

export function PlacesMap({ places, data, onOpenPlace }) {
  const model = mapModel(places, data);
  const board = useRef(null);
  const packets = useRef(null);
  const seen = useRef(null);
  const [wires, setWires] = useState([]);
  const [size, setSize] = useState(0);

  // A card's box on the board.
  const box = (id) => {
    const el = board.current?.querySelector('[data-node="' + id + '"]');
    if (!el) return null;
    const b = board.current.getBoundingClientRect(),
      r = el.getBoundingClientRect();
    const left = r.left - b.left,
      top = r.top - b.top;
    return { left, top, right: left + r.width, bottom: top + r.height, x: left + r.width / 2, y: top + r.height / 2 };
  };
  const center = (id) => {
    const r = box(id);
    return r && [r.x, r.y];
  };
  // A wire goes from edge to edge (never across the text of a card or a place's header).
  const ends = (a, b) => {
    const r = box(a),
      s = box(b);
    if (!r || !s) return null;
    if (Math.abs(s.y - r.y) > Math.abs(s.x - r.x) * 0.6)
      return r.y < s.y
        ? [
            [r.x, r.bottom],
            [s.x, s.top],
          ]
        : [
            [r.x, r.top],
            [s.x, s.bottom],
          ];
    return r.x < s.x
      ? [
          [r.right, r.y],
          [s.left, s.y],
        ]
      : [
          [r.left, r.y],
          [s.right, s.y],
        ];
  };
  // The wires follow the cards: measured after each layout and when the board changes size.
  const key = JSON.stringify([
    model.links,
    model.zones.map((z) => [z.id, z.teams.map((t) => t.wires), z.nodes.length, z.vesta.length]),
  ]);
  useLayoutEffect(() => {
    const out = [];
    for (const z of model.zones)
      for (const t of z.teams)
        for (const [a, b] of t.wires) {
          const e = ends(a, b);
          if (e) out.push({ key: a + '|' + b, ...curve(...e), cls: t.crossing.includes(a + '|' + b) ? 'cross' : '' });
        }
    for (const l of model.links) {
      const e = ends(l.from, l.to);
      if (e) out.push({ key: l.from + '|' + l.to, ...curve(...e), cls: 'cross' + (l.down ? ' down' : ''), tag: l });
    }
    setWires(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout key says when the cards moved
  }, [key, size]);
  useEffect(() => {
    if (!board.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize((n) => n + 1));
    ro.observe(board.current);
    return () => ro.disconnect();
  }, []);

  // New events travel; the ones already there when the map opened do not.
  useEffect(() => {
    const ids = model.events.map((e) => e.id);
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = model.events.filter((e) => !seen.current.has(e.id)).reverse();
    for (const id of ids) seen.current.add(id);
    if (reduced()) return;
    // A message held for an offline place does not travel (yet).
    fresh
      .filter((e) => !e.held)
      .slice(-MAX_BURST)
      .forEach((e, i) => setTimeout(() => travel(e), i * 350));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the events' ids
  }, [model.events.map((e) => e.id).join()]);

  function travel(e) {
    const p = center(e.from),
      q = center(e.to);
    const layer = packets.current;
    if (!p || !q || !layer) return;
    const path = svgEl('path', { d: curve(p, q).d, class: 'pmap-track' }, layer);
    const g = svgEl('g', { class: 'pmap-packet ' + e.kind }, layer);
    const halo = svgEl('circle', { class: 'halo', r: 10 }, g);
    const core = svgEl(
      e.kind === 'task' ? 'rect' : 'circle',
      e.kind === 'task' ? { x: -5, y: -5, width: 10, height: 10 } : { r: 5 },
      g
    );
    core.setAttribute('class', 'core');
    const from = board.current.querySelector('[data-node="' + e.from + '"]');
    from?.setAttribute('data-sending', 'true');
    const len = path.getTotalLength();
    const dur = e.cross ? 2300 : 1500,
      start = performance.now();
    const frame = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pt = path.getPointAtLength(len * ease);
      core.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')');
      halo.setAttribute('cx', pt.x);
      halo.setAttribute('cy', pt.y);
      if (k < 1) return requestAnimationFrame(frame);
      g.remove();
      path.remove();
      from?.removeAttribute('data-sending');
      const to = board.current?.querySelector('[data-node="' + e.to + '"]');
      to?.classList.remove('got');
      void to?.offsetWidth;
      to?.classList.add('got');
    };
    requestAnimationFrame(frame);
  }

  const now = Date.now();
  return (
    <div className="pmap">
      <div className="pmap-board" ref={board} aria-label="Mapa dos lugares">
        <svg className="pmap-wires" aria-hidden="true">
          {wires.map((w) => (
            <g key={w.key} className={'pmap-wire ' + w.cls}>
              <path d={w.d} />
              {w.tag && (
                <text x={w.mid[0]} y={w.mid[1] - 7} textAnchor="middle">
                  {w.tag.down ? '✕ ssh' : 'ssh'}
                </text>
              )}
            </g>
          ))}
          <g ref={packets} />
        </svg>
        {model.zones.map((z) => (
          <section key={z.id} className={'pmap-zone' + (z.online ? '' : ' off')} data-zone={z.id}>
            <button className="pmap-zone-head" data-node={'zone:' + z.id} onClick={() => onOpenPlace(z.id)}>
              <i className={'place-dot ' + (z.online ? 'on' : 'off')} />
              <b>{z.name}</b>
              <small>{z.kind}</small>
              {!z.online && <span className="place-bad">✕ fora do ar</span>}
              <span className="place-count">
                {z.nodes.length + z.vesta.length + z.teams.reduce((n, t) => n + t.members.length, 0)}
              </span>
            </button>
            {z.id === 'pc' && (
              <div className="pmap-group">
                <div className="pmap-label">VESTA ABERTO · SÓ RODA COM O APP ABERTO</div>
                <div className="pmap-nodes">
                  <div className="pmap-card you" data-node="voce">
                    <b>Você</b>
                    <small>no VeSTA</small>
                  </div>
                  {z.vesta.map((n) => (
                    <Card key={n.id} n={n} />
                  ))}
                </div>
                {z.teams.map((t) => (
                  <Team key={t.id} t={t} />
                ))}
              </div>
            )}
            {z.remote && z.teams.length > 0 && (
              <div className="pmap-group">
                <div className="pmap-label">EQUIPES · O VESTA LEVA AS MENSAGENS PELO SSH</div>
                {z.teams.map((t) => (
                  <Team key={t.id} t={t} />
                ))}
              </div>
            )}
            {(z.remote || z.nodes.length > 0) && (
              <div className="pmap-group">
                <div className="pmap-label">
                  {z.remote
                    ? 'AGENDADOR DA VPS · COM O SEU PC DESLIGADO'
                    : 'AGENDADOR DO WINDOWS · COM O VESTA FECHADO'}
                </div>
                <div className="pmap-nodes">
                  {z.nodes.map((n) => (
                    <Card key={n.id} n={n} />
                  ))}
                  {!z.nodes.length && <p className="pmap-empty">Nenhum agent instalado aqui.</p>}
                </div>
              </div>
            )}
          </section>
        ))}
      </div>
      <aside className="pmap-log" aria-label="O que passou pelos fios">
        <h3>O QUE PASSOU PELOS FIOS</h3>
        {model.events.length ? (
          model.events.map((e) => (
            <div key={e.id} className={'pmap-entry' + (e.error ? ' err' : '')}>
              <time>{agoLabel(e.at, now)}</time>
              <div>
                <div className="pmap-route">
                  <b>{e.route}</b> · {KIND[e.kind] || e.kind}
                  <span className={'pmap-where' + (e.cross ? ' cross' : '')}>{e.where}</span>
                </div>
                <p>
                  {e.error && <span className="place-bad">✕ falhou</span>}
                  {e.held && <span className="place-bad">na fila: lugar fora do ar</span>} {e.text}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="pmap-empty">
            Quando uma equipe conversar ou um agent terminar num lugar, aparece aqui e corre pelo fio.
          </p>
        )}
      </aside>
    </div>
  );
}

// A team's frame in one place (a team split across places has one in each).
function Team({ t }) {
  return (
    <div className={'pmap-team ' + t.status} data-team={t.name}>
      <span className="pmap-team-label">
        {(/^equipe\b/i.test(t.name) ? '' : 'EQUIPE · ') + t.name.toUpperCase() + ' · ' + t.project}
      </span>
      <div className="pmap-nodes">
        {t.members.map((m) => (
          <Card key={m.id} n={{ ...m, sub: m.lead ? 'líder · ' + m.role : m.role, running: m.working }} />
        ))}
        {!t.members.length && <p className="pmap-empty">Todos os agents desta equipe rodam em outro lugar.</p>}
      </div>
    </div>
  );
}

function Card({ n }) {
  return (
    <div
      className={'pmap-card' + (n.off ? ' dim' : '') + (n.lead ? ' lead' : '')}
      data-node={n.id}
      data-state={n.running ? 'working' : n.error ? 'error' : 'idle'}
    >
      <span className="pmap-card-top">
        {n.provider && <ProviderIcon id={n.provider} small />}
        <b>{n.name}</b>
      </span>
      {n.sub && <small>{n.sub}</small>}
      {n.error && !n.running && <span className="place-bad">✕ falhou</span>}
      {n.running && <span className="place-running">■ rodando</span>}
    </div>
  );
}
