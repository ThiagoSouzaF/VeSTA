// Skills screen logic (pure): grouping by origin, search and filters, what the skills cost and the "/" menu.

// The four AIs in the order the badges show them.
export const AIS = [
  ['claude', 'C', 'Claude'],
  ['codex', 'G', 'ChatGPT (Codex)'],
  ['opencode', 'O', 'OpenCode'],
  ['drael', 'D', 'Drael'],
];
const OWN = 'Criadas por você';
// Tokens one skill adds to the catalog every fresh session gets ("A IA decide" skills only).
export const catalogTokens = (s) => Math.ceil((s.name.length + Math.min((s.description || '').length, 180) + 4) / 3.6);
// Cost of using a skill (its full text): 1 light, 2 medium, 3 heavy.
export const costLevel = (s) => ((s.tokens || 0) < 1500 ? 1 : (s.tokens || 0) < 4000 ? 2 : 3);
export const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

// Whether an AI can follow the skill -> { ok, why }.
export function aiState(s, id) {
  const v = s.compat?.[id];
  return !v || v === 'ok' ? { ok: true, why: s.adaptedBy ? 'adaptada' : 'como veio' } : { ok: false, why: v };
}

export function budget(list) {
  const on = list.filter((s) => s.enabled);
  return { on: on.length, catalog: on.filter((s) => s.mode === 'auto').reduce((a, s) => a + catalogTokens(s), 0) };
}

export const FILTERS = [
  ['all', 'Todas'],
  ['on', 'Ativas'],
  ['slash', 'Só com /'],
  ['heavy', 'Custo alto'],
];
export function filterSkills(list, { query = '', filter = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  return list.filter(
    (s) =>
      (!q || s.name.includes(q) || (s.description || '').toLowerCase().includes(q)) &&
      (filter === 'all' ||
        (filter === 'on' && s.enabled) ||
        (filter === 'slash' && s.mode === 'slash') ||
        (filter === 'heavy' && costLevel(s) === 3))
  );
}

// By origin: repositories in alphabetical order, the person's own skills last.
export function groupBySource(list) {
  const groups = new Map();
  for (const s of list) {
    const label = s.source?.label || OWN;
    if (!groups.has(label)) groups.set(label, { label, url: s.source?.url || '', license: '', items: [] });
    const g = groups.get(label);
    g.items.push(s);
    g.license ||= s.source?.license || '';
    if (s.source?.kind === 'github' && !g.url) g.url = s.source.url;
  }
  return [...groups.values()].sort((a, b) =>
    a.label === OWN ? 1 : b.label === OWN ? -1 : a.label.localeCompare(b.label)
  );
}

// The "/" menu: open while the message is only "/" plus letters of a name; null when it should stay closed.
export function slashMatches(list, text) {
  const m = /^\/([a-z0-9-]*)$/i.exec(text || '');
  if (!m) return null;
  const q = m[1].toLowerCase();
  const on = (list || []).filter((s) => s.enabled);
  return [...on.filter((s) => s.name.startsWith(q)), ...on.filter((s) => !s.name.startsWith(q) && s.name.includes(q))];
}

// A message sent as "/nome resto": the chip shows the skill, the text shows the rest.
export function splitSlash(text, skill) {
  if (!skill) return { skill: null, rest: text };
  const rest = String(text || '').replace(new RegExp('^/' + skill + '(\\s+|$)'), '');
  return { skill, rest };
}
