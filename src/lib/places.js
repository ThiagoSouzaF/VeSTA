// Onde rodam (pure): where each agent runs — VeSTA open (the way it always was) or a place where it was installed to
// run with VeSTA closed (electron/places). Phase 1 has one place, this PC.
import shared from '../../electron/shared/agents.cjs';

const { installedSomewhere } = shared;
export const PLACE_NAMES = { pc: 'Este PC' };
// The chips of an agent: [{ id, label, running, outdated }]. Not installed anywhere = it runs with VeSTA open.
export function whereOf(agent) {
  if (!installedSomewhere(agent)) return [{ id: 'vesta', label: 'VeSTA aberto' }];
  return Object.entries(agent.places).map(([id, p]) => ({
    id,
    label: PLACE_NAMES[id] || id,
    running: !!p.running,
    outdated: !!p.outdated,
  }));
}
export const WHERE_FILTERS = [
  ['all', 'Todos'],
  ['vesta', 'VeSTA aberto'],
  ['pc', 'Este PC'],
];
export const filterWhere = (agents, where) =>
  where === 'all' ? agents : agents.filter((a) => whereOf(a).some((w) => w.id === where));

// The install window: each agent as a square, by what it needs on this place (place.ais: what the place has).
//   here   already installed here       need   its AI is not installed here       ready  can go
export function installStatus(agent, place) {
  if (place.agents.some((x) => x.agentId === agent.id)) return { kind: 'here' };
  if (!place.ais?.[agent.provider]?.installed) return { kind: 'need', text: 'A IA dele não está instalada aqui' };
  const warn = [
    agent.memory ? 'roda sem a memória do VeSTA' : '',
    agent.mode === 'ask' ? '"Pedir permissão" vira "Só consulta"' : '',
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
