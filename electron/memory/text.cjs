// Turns AI Memory tool answers into text the agent and the user can read, and detects failures hidden in payloads.
// Tool answers that report their failure inside a JSON payload instead of `isError`.
function payloadError(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('{')) return '';
  try {
    const j = JSON.parse(t);
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      if (j.error) return typeof j.error === 'string' ? j.error : j.error.message || JSON.stringify(j.error);
      if (j.ok === false || j.success === false) return j.message || j.reason || 'Falha no AI Memory';
      if (j.reason === 'precondition_failed') return 'A página mudou antes da gravação (precondition_failed)';
    }
  } catch {}
  return '';
}
// memory_briefing JSON -> a few lines the agent (and the user) can read.
function briefingText(raw) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return String(raw || '').slice(0, 3000);
  }
  const lines = [];
  const c = j.counts || {};
  lines.push(
    'Projeto ' +
      (j.scope?.project || '') +
      ': ' +
      (c.pages_latest ?? 0) +
      ' páginas, ' +
      (c.sessions ?? 0) +
      ' sessões' +
      (j.activity_7d ? ' (' + j.activity_7d.sessions + ' nos últimos 7 dias)' : '') +
      '.'
  );
  if (j.pending_handoff_count)
    lines.push(j.pending_handoff_count + ' passagem(ns) de contexto pendente(s) de outra IA.');
  for (const r of j.rules || []) lines.push('Regra: ' + (r.title || r.path) + (r.path ? ' (' + r.path + ')' : ''));
  for (const s of j.slots || []) lines.push('Decisão: ' + (s.title || s.path || JSON.stringify(s)).slice(0, 200));
  if ((j.recent_pages || []).length)
    lines.push(
      'Páginas recentes: ' +
        j.recent_pages
          .slice(0, 8)
          .map((p) => (p.title || p.path) + ' (' + p.path + ')')
          .join('; ')
    );
  return lines.join('\n').slice(0, 3000);
}
// Portuguese and English words too common to search for (they would match almost every page).
const STOP_WORDS = new Set(
  (
    'que com para por uma uns umas dos das nos nas num numa pelo pela pelos pelas sem sob sobre entre ate até ' +
    'mas mais menos muito muita muitos como quando onde qual quais quem isso isto esse essa esses essas este esta ' +
    'estes estas aquele aquela aqui ali ser sao são foi era tem ter tinha vai vou pode posso fazer faz faça faca ' +
    'agora ainda tambem também ja já nao não sim seu sua seus suas meu minha meus minhas voce você voces vocês ' +
    'ele ela eles elas nós nos the and for with that this from have are was you your not but can will what ' +
    'please favor quero queria gostaria preciso ajuda ajude deve devem cada todo toda todos todas'
  ).split(/\s+/)
);
const unmark = (s) =>
  String(s || '')
    .replace(/<\/?mark>/g, '')
    .replace(/^#+\s.*$/m, '')
    .replace(/\s+/g, ' ')
    .trim();
// memory_query JSON -> a few readable lines with the project's own hits. Profile hits (global_scope_hits) stay out:
// the profile is sent on its own at the start of a session. '' when nothing in the project matched.
function queryText(raw, { limit = 4, snippet = 220 } = {}) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return String(raw || '')
      .trim()
      .slice(0, 2000);
  }
  const hits = (Array.isArray(j?.hits) ? j.hits : []).slice(0, limit);
  if (!hits.length) return '';
  return (
    'Notas do projeto que parecem relacionadas:\n' +
    hits
      .map((h) => {
        const body = unmark(h.snippet).slice(0, snippet);
        return '- ' + unmark(h.title || h.path) + (h.path ? ' (' + h.path + ')' : '') + (body ? ': ' + body : '');
      })
      .join('\n')
  );
}
// The order the profile goes in: how the person works first, project-like details last (they are cut first).
const PROFILE_ORDER = ['workflow', 'style', 'testing', 'tools', 'habits', 'stack', 'architecture'];
// One line per profile entry, without the quoted evidence the server appends ( - "..." (vesta/inbox, date)), most
// important categories first, within `max` characters.
function profileText(entries, max = 3000) {
  const rank = (c) => {
    const i = PROFILE_ORDER.indexOf(c);
    return i < 0 ? PROFILE_ORDER.length : i;
  };
  const lines = [...entries]
    .sort((a, b) => rank(a.category) - rank(b.category))
    .map((e) => {
      let s = String(e.statement || '')
        .split(/\s+-\s+["“]/)[0]
        .replace(/\s+/g, ' ')
        .trim();
      if (s.length > 240) s = s.slice(0, 237) + '...';
      return s && '- [' + e.category + '] ' + s;
    })
    .filter(Boolean);
  const out = [];
  let size = 0;
  for (const l of lines) {
    if (size + l.length + 1 > max) break;
    out.push(l);
    size += l.length + 1;
  }
  return out.join('\n');
}
module.exports = { briefingText, payloadError, queryText, profileText, STOP_WORDS };
