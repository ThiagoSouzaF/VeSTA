// Onde rodam (pure): where each agent runs — VeSTA open (the way it always was) or a place where it was installed to
// run with VeSTA closed (electron/places): this PC ('pc') or a VPS reached by SSH (state.places).
import shared from '../../electron/shared/agents.cjs';
import teamsShared from '../../electron/shared/teams.cjs';
import { describeSchedule } from './agents.js';

const { installedSomewhere } = shared;
const { HUMAN: TEAM_HUMAN, wiresOf: teamWires } = teamsShared;
// The places VeSTA knows: this PC first, then each VPS (places = state.places).
export const knownPlaces = (places = []) => [
  { id: 'pc', name: 'Este PC', online: true },
  ...places.map((p) => ({ id: p.id, name: p.name, online: p.online !== false })),
];
// The chips of an agent: [{ id, label, remote, online, running, outdated }]. Not installed anywhere = it runs with
// VeSTA open.
export function whereOf(agent, places = []) {
  if (!installedSomewhere(agent)) return [{ id: 'vesta', label: 'VeSTA aberto', online: true }];
  const known = knownPlaces(places);
  return Object.entries(agent.places).map(([id, p]) => {
    const k = known.find((x) => x.id === id);
    return {
      id,
      label: k?.name || 'lugar esquecido',
      remote: id !== 'pc',
      online: k ? k.online : false,
      running: !!p.running,
      outdated: !!p.outdated,
    };
  });
}
// The ONDE filters of the Agents screen: everyone, VeSTA open, then each place.
export const whereFilters = (places = []) => [
  ['all', 'Todos'],
  ['vesta', 'VeSTA aberto'],
  ...knownPlaces(places).map((p) => [p.id, p.name]),
];
export const filterWhere = (agents, where, places = []) =>
  where === 'all' ? agents : agents.filter((a) => whereOf(a, places).some((w) => w.id === where));

// The install window: each agent as a square, by what it needs on this place (place.ais: what the place has).
//   here   already installed here       need   its AI is not installed here       ready  can go
export function installStatus(agent, place) {
  if (place.agents.some((x) => x.agentId === agent.id)) return { kind: 'here' };
  if (!place.ais?.[agent.provider]?.installed)
    return { kind: 'need', text: place.ais?.[agent.provider]?.note || 'A IA dele não está instalada aqui' };
  const warn = [
    agent.memory ? 'roda sem a memória do VeSTA' : '',
    agent.mode === 'ask' ? '"Pedir permissão" vira "Só consulta"' : '',
    // The project folder is on this PC: on a VPS the agent works in its own work/ folder.
    place.remote && agent.projectId ? 'lá trabalha na pasta work/ (o projeto fica neste PC)' : '',
  ].filter(Boolean);
  return { kind: 'ready', warn };
}
export const INSTALL_TABS = [
  ['all', 'Todos'],
  ['ready', 'Prontos'],
  ['need', 'Precisam de algo'],
  ['here', 'Já estão aqui'],
];
export function installTiles(agents, place, { tab = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return agents
    .map((a) => ({ agent: a, status: installStatus(a, place) }))
    .filter(
      ({ agent, status }) =>
        (tab === 'all' || status.kind === tab) && (!q || (agent.name + ' ' + agent.prompt).toLowerCase().includes(q))
    );
}

// The folder as a tree: [key, line, comment] (key = the agent's slug, to light it up on hover).
export function folderTree(place) {
  const sep = place.home.includes('\\') ? '\\' : '/';
  const rows = [
    ['', place.home + sep, ''],
    ['', '├─ runner' + sep, 'o executor' + (place.runner.installed ? ' (' + place.runner.installed.version + ')' : '')],
    ['', '├─ config.json', 'onde está cada IA e como o agendador chama o executor'],
    ['', '└─ agents' + sep, ''],
  ];
  place.agents.forEach((x, i) => {
    const last = i === place.agents.length - 1,
      bar = last ? '    ' : '   │';
    rows.push(
      [x.slug, '   ' + (last ? '└─ ' : '├─ ') + x.slug + sep, x.name],
      [x.slug, bar + ' ├─ agent.json', 'pedido, agenda, IA, modo e lições aprovadas'],
      [x.slug, bar + ' ├─ skills' + sep, 'as skills do agent'],
      [x.slug, bar + ' ├─ work' + sep, 'pasta de trabalho, se não tiver projeto'],
      [x.slug, bar + ' └─ runs' + sep, 'uma execução por arquivo']
    );
  });
  return rows;
}

// ---- Mapa: every place side by side ---------------------------------------------------------------------------------
// zones: one per place. This PC holds "VeSTA aberto" (you, the teams — they always run with VeSTA open — and the agents
// not installed anywhere) and the agents of its scheduler; a VPS holds the agents installed there.
// links: this PC (where VeSTA runs) and each VPS (VeSTA reads it over SSH; cut while it is offline). events: the latest team messages and
// runs that came back from a place, newest first; each has from/to node ids for the packet that travels.
// Node ids: 'voce', 't:<team>:<member>', 'a:<agent>:<place | vesta>'.
const YOU = 'voce';
export function mapModel(places, { agents = [], teams = [], projects = [] } = {}) {
  const projectName = (id) => projects.find((p) => p.id === id)?.name || 'Espaço pessoal';
  const failed = (a) => a.runs?.[0]?.status === 'error';
  const agentNode = (a, where) => ({
    id: 'a:' + a.id + ':' + where,
    agentId: a.id,
    name: a.name,
    provider: a.provider,
    sub: describeSchedule(a.schedule),
    running: where === 'vesta' ? false : !!a.places?.[where]?.running,
    off: where === 'vesta' && !a.enabled,
    error: failed(a),
  });
  const zones = places.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    online: p.online !== false,
    remote: !!p.remote,
    teams: [],
    vesta: [],
    nodes: agents.filter((a) => a.places?.[p.id]).map((a) => agentNode(a, p.id)),
  }));
  const pc = zones.find((z) => z.id === 'pc');
  if (pc) {
    pc.vesta = agents.filter((a) => !installedSomewhere(a)).map((a) => agentNode(a, 'vesta'));
    pc.teams = teams.map((t) => ({
      id: t.id,
      name: t.name,
      project: projectName(t.projectId),
      status: t.status,
      members: [...t.members]
        .sort((x, y) => (y.lead ? 1 : 0) - (x.lead ? 1 : 0))
        .map((m) => ({
          id: 't:' + t.id + ':' + m.id,
          name: m.name,
          role: m.role,
          provider: m.provider,
          lead: !!m.lead,
          working: !!m.busy,
        })),
      wires: teamWires(t).map(([a, b]) => [memberNode(t, a), memberNode(t, b)]),
    }));
  }
  const links = zones.filter((z) => z.remote).map((z) => ({ from: 'zone:pc', to: 'zone:' + z.id, down: !z.online }));
  return { zones, links, events: mapEvents(places, { agents, teams }) };
}
const memberNode = (team, id) => (id === TEAM_HUMAN ? YOU : 't:' + team.id + ':' + id);
export function mapEvents(places, { agents = [], teams = [] } = {}, max = 14) {
  const name = (id) => places.find((p) => p.id === id)?.name || id;
  const out = [];
  for (const t of teams) {
    const who = (id) => (id === TEAM_HUMAN ? 'Você' : t.members.find((m) => m.id === id)?.name || id);
    for (const m of (t.messages || []).slice(-30))
      if (m.kind !== 'note' && m.from && m.to)
        out.push({
          id: 'm:' + m.id,
          at: m.at,
          kind: m.kind,
          from: memberNode(t, m.from),
          to: memberNode(t, m.to),
          route: who(m.from) + ' → ' + who(m.to),
          where: t.name,
          text: m.text,
        });
  }
  for (const a of agents)
    for (const r of (a.runs || []).slice(0, 10))
      if (r.place)
        out.push({
          id: 'r:' + r.id,
          at: r.endedAt || r.at,
          kind: r.status === 'error' ? 'error' : 'answer',
          from: 'a:' + a.id + ':' + r.place,
          to: YOU,
          route: a.name + ' → Você',
          where: name(r.place),
          cross: r.place !== 'pc',
          error: r.status === 'error',
          text: r.status === 'error' ? r.error || 'falhou' : r.summary || 'terminou',
        });
  return out.sort((x, y) => y.at - x.at).slice(0, max);
}
