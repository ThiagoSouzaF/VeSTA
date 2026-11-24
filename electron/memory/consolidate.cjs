// What an AI reads and writes when it consolidates the shared memory (see consolidator.cjs). Pure.
//
// One batch = one project: the stretches of conversation waiting in state.memoryToConsolidate (new material) and the
// memories that came from conversations (rules, gotchas, decisions, concepts, conversation summaries and the old raw
// pages). The AI answers with the pages to write (new, updated, or one concise page that merges several repeated ones)
// and the memories they make redundant, which VeSTA deletes. What the person wrote (notes, preferences) is never sent
// here, so it is never merged or removed.
//
// Waiting item { sessionId, chatId, projectId, provider, startedAt, endedAt, turns, attempts }
const { redact } = require('./redact.cjs');
const { ellipsis: clip, slug } = require('../util/text.cjs');

// Page type -> folder in the project wiki (the Memória screen labels them by folder).
const FOLDERS = { rule: '_rules/', gotcha: 'gotchas/', decision: 'decisions/', concept: 'concepts/' };
const MAX_USER = 2000;
const MAX_ANSWER = 3000;
const STRETCH_CHARS = 25000;
const PAGE_CHARS = 35000;
const MAX_STRETCHES = 12;
const PAGE_EXCERPT = 600;
const MAX_PAGES = 30;
const MAX_TITLE = 120;
const MAX_BODY = 6000;
// The AI may not empty a batch without writing anything: above this share of its memories removed, nothing changes.
const MAX_REMOVED_SHARE = 0.9;

// Memories that came from conversations, and so can be merged or removed by the consolidation.
const fromConversations = (n) => n.kind === 'insight' || n.kind === 'session';

// The messages of one stretch (between its first prompt and its close), as plain lines.
function stretchText(chat, item) {
  const from = item.startedAt - 5000,
    to = (item.endedAt || Date.now()) + 5000;
  return (chat?.messages || [])
    .filter((m) => m.text && m.createdAt >= from && m.createdAt <= to && (m.role === 'user' || m.status !== 'error'))
    .map((m) =>
      m.role === 'user' ? 'Pessoa: ' + clip(redact(m.text), MAX_USER) : 'IA: ' + clip(redact(m.text), MAX_ANSWER)
    )
    .join('\n\n');
}
const pageText = (n) =>
  clip(
    redact(String(n.body || ''))
      .replace(/\s+/g, ' ')
      .trim(),
    PAGE_EXCERPT
  );

// Consecutive groups of `list` whose sizes add up to at most `budget` (and `max` items).
function chunks(list, size, budget, max = Infinity) {
  const out = [];
  let cur = null,
    used = 0;
  for (const x of list) {
    const n = size(x);
    if (!cur || cur.length >= max || used + n > budget) {
      out.push((cur = []));
      used = 0;
    }
    cur.push(x);
    used += n;
  }
  return out;
}

// -> [{ projectId, stretches: [{ item, chat, text }], pages: [note] }], one project per batch.
// `compact(projectId)` says whether the project's memories go too (a project with stretches always sends them, so new
// material is merged with what is already there). With nothing new, a project needs 2 memories or more to be reviewed.
function batchesOf(items, chatOf, { memories = [], compact = () => false } = {}) {
  const projects = new Map();
  const of = (key) => {
    if (!projects.has(key)) projects.set(key, { stretches: [], pages: [] });
    return projects.get(key);
  };
  for (const item of items) {
    const chat = chatOf(item.chatId);
    const text = chat && stretchText(chat, item);
    if (text) of(item.projectId || '').stretches.push({ item, chat, text });
  }
  const pagesBy = new Map();
  for (const n of memories.filter(fromConversations)) {
    const key = n.projectId || '';
    if (!pagesBy.has(key)) pagesBy.set(key, []);
    pagesBy.get(key).push(n);
  }
  for (const [key, pages] of pagesBy)
    if (projects.has(key) || (pages.length >= 2 && compact(key || null))) of(key).pages = pages;
  const out = [];
  for (const [key, p] of projects) {
    // Same kind of page next to each other, so repeated ones meet in the same batch.
    const pages = [...p.pages].sort((a, b) => (a.path || '').localeCompare(b.path || ''));
    const s = chunks(p.stretches, (x) => x.text.length, STRETCH_CHARS, MAX_STRETCHES);
    const g = chunks(pages, (n) => pageText(n).length + 120, PAGE_CHARS);
    for (let i = 0; i < Math.max(s.length, g.length); i++)
      out.push({ projectId: key || null, stretches: s[i] || [], pages: g[i] || [] });
  }
  return out;
}

function buildConsolidationPrompt({ projectName = '', stretches = [], pages = [] }) {
  const where = projectName ? 'do projeto "' + projectName + '"' : 'do espaço pessoal (fora de projetos)';
  const attr = (v) => String(v).replace(/"/g, "'");
  const talks = stretches.map(
    (s) =>
      '<conversa id="' +
      s.item.sessionId +
      '" titulo="' +
      attr(clip(s.chat.title, 80)) +
      '" ia="' +
      s.item.provider +
      '">\n' +
      s.text +
      '\n</conversa>'
  );
  const known = pages.map(
    (n) =>
      '<memoria path="' + attr(n.path) + '" titulo="' + attr(clip(n.title, 100)) + '">' + pageText(n) + '</memoria>'
  );
  return [
    'Você é o consolidador da memória compartilhada do VeSTA, ' + where + '.',
    'Seu trabalho é deixar a memória menor, sem repetição e fácil de usar por qualquer IA em conversas futuras.',
    '',
    '## Regras',
    '- Não use ferramentas nem altere arquivos: só leia e responda.',
    '- Guarde só o que é durável: regras do projeto, armadilhas (o que deu errado e por quê), decisões (o que foi escolhido e o motivo) e conceitos (como algo funciona). Ignore conversa passageira.',
    '- Junte memórias repetidas ou parecidas numa página só, curta e completa, e liste em "replaces" o path de todas as que ela substitui. Prefira poucas páginas densas a muitas pequenas.',
    '- Resumos de conversa (sessions/, conversas/) que só repetem o que já está numa página, ou que não têm nada durável, vão em "remove".',
    '- Nunca remova uma informação única: se só uma memória tem um fato, ele precisa continuar em alguma página.',
    '- Para atualizar uma memória, devolva o mesmo "path" com o texto completo novo.',
    '- Cada página: título curto e corpo em markdown que se entende sozinho, sem citar "a conversa".',
    '- Nunca copie senhas, tokens, chaves ou dados pessoais.',
    '- Um resumo de 1 a 3 frases só para conversas novas com contexto útil que não virou página.',
    '- Se não houver nada a mudar, devolva listas vazias.',
    '',
    '## Resposta',
    'Só um bloco ```json, neste formato:',
    '```json',
    '{"pages":[{"type":"rule|gotcha|decision|concept","title":"...","body":"...","path":"(opcional, para atualizar)","replaces":["paths que esta página substitui"]}],"remove":["paths"],"sessions":[{"id":"<id da conversa>","title":"...","summary":"..."}]}',
    '```',
    ...(known.length ? ['', '## Memórias atuais (' + known.length + ', resumidas)', ...known] : []),
    ...(talks.length ? ['', '## Conversas novas', ...talks] : []),
  ].join('\n');
}

// The last ```json block (or the whole answer) -> { pages, sessions, removed }. Throws when there is no usable JSON or
// when the AI would remove almost every memory of the batch.
function parseConsolidationReply(reply, { sessionIds = [], pages: known = [] } = {}) {
  const src = String(reply || '');
  const blocks = [...src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  let data = null;
  for (const text of [...blocks.reverse(), src])
    try {
      data = JSON.parse(text.trim());
      break;
    } catch {}
  if (!data || typeof data !== 'object') throw new Error('A IA não devolveu a consolidação em JSON.');
  const paths = new Set(known.map((n) => n.path));
  const list = (v) => (Array.isArray(v) ? v.map(String).filter((p) => paths.has(p)) : []);
  const pages = (Array.isArray(data.pages) ? data.pages : [])
    .filter((p) => p && FOLDERS[p.type] && String(p.title || '').trim() && String(p.body || '').trim())
    .slice(0, MAX_PAGES)
    .map((p) => {
      const title = clip(redact(String(p.title).replace(/\s+/g, ' ').trim()), MAX_TITLE);
      // Only a path from the batch is reused (as is); any other becomes a new page in its type's folder.
      const path = paths.has(p.path) ? p.path : FOLDERS[p.type] + slug(title, 60, 'pagina') + '.md';
      return {
        path,
        title,
        body: clip(redact(String(p.body).trim()), MAX_BODY),
        kind: 'insight',
        replaces: list(p.replaces),
      };
    });
  const ids = new Set(sessionIds);
  const sessions = (Array.isArray(data.sessions) ? data.sessions : [])
    .filter((s) => s && ids.has(s.id) && String(s.summary || '').trim())
    .map((s) => ({
      sessionId: s.id,
      path: 'sessions/' + s.id + '.md',
      title: clip(
        redact(
          String(s.title || 'Conversa')
            .replace(/\s+/g, ' ')
            .trim()
        ),
        MAX_TITLE
      ),
      body: clip(redact(String(s.summary).trim()), MAX_BODY),
      kind: 'session',
    }));
  // A page written now is never removed, even if the AI also listed it.
  const kept = new Set([...pages, ...sessions].map((p) => p.path));
  const removed = [...new Set([...pages.flatMap((p) => p.replaces), ...list(data.remove)])].filter((p) => !kept.has(p));
  if (!kept.size && known.length >= 3 && removed.length > known.length * MAX_REMOVED_SHARE)
    throw new Error('A IA quis apagar quase todas as memórias deste lote; nada foi mudado.');
  return { pages: pages.map(({ replaces, ...p }) => p), sessions, removed };
}

module.exports = {
  stretchText,
  batchesOf,
  buildConsolidationPrompt,
  parseConsolidationReply,
  fromConversations,
  FOLDERS,
};
