// What an AI reads and writes when it consolidates the shared memory (see consolidator.cjs). Pure: the stretches of
// conversation waiting in state.memoryToConsolidate become one prompt per project, and the AI's JSON answer becomes the
// pages VeSTA writes to AI Memory: rules, gotchas, decisions, concepts and a short summary of each stretch.
//
// Waiting item { sessionId, chatId, projectId, provider, startedAt, endedAt, turns, attempts }
const { redact } = require('./redact.cjs');
const { ellipsis: clip, slug } = require('../util/text.cjs');

// Page type -> folder in the project wiki (the Memória screen labels them by folder).
const FOLDERS = { rule: '_rules/', gotcha: 'gotchas/', decision: 'decisions/', concept: 'concepts/' };
const MAX_USER = 2000;
const MAX_ANSWER = 3000;
const MAX_BATCH_CHARS = 60000;
const MAX_BATCH = 12;
const MAX_PAGES = 20;
const MAX_TITLE = 120;
const MAX_BODY = 6000;
const MAX_EXISTING = 60;

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

// Waiting items -> batches of one project each, small enough for one turn. Items whose chat is gone are left out.
function batchesOf(items, chatOf) {
  const byProject = new Map();
  for (const item of items) {
    const chat = chatOf(item.chatId);
    const text = chat && stretchText(chat, item);
    if (!text) continue;
    const key = item.projectId || '';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push({ item, chat, text });
  }
  const out = [];
  for (const [projectId, list] of byProject) {
    let cur = null;
    for (const s of list) {
      if (!cur || cur.stretches.length >= MAX_BATCH || cur.size + s.text.length > MAX_BATCH_CHARS)
        out.push((cur = { projectId: projectId || null, stretches: [], size: 0 }));
      cur.stretches.push(s);
      cur.size += s.text.length;
    }
  }
  return out;
}

function buildConsolidationPrompt({ projectName = '', stretches, existing = [] }) {
  const where = projectName ? 'do projeto "' + projectName + '"' : 'do espaço pessoal (fora de projetos)';
  const known = existing.slice(0, MAX_EXISTING).map((n) => '- ' + n.path + ' — ' + n.title);
  const parts = stretches.map(
    (s, i) =>
      '<conversa id="' +
      s.item.sessionId +
      '" n="' +
      (i + 1) +
      '" titulo="' +
      clip(s.chat.title, 80).replace(/"/g, "'") +
      '" ia="' +
      s.item.provider +
      '">\n' +
      s.text +
      '\n</conversa>'
  );
  return [
    'Você é o consolidador da memória compartilhada do VeSTA, ' + where + '.',
    'Leia os trechos de conversa abaixo e extraia o que vale lembrar em conversas futuras, com qualquer IA.',
    '',
    '## Regras',
    '- Não use ferramentas nem altere arquivos: só leia e responda.',
    '- Guarde só o que é durável: regras do projeto, armadilhas (algo que deu errado e por quê), decisões (o que foi escolhido e o motivo) e conceitos (como algo funciona). Ignore conversa passageira.',
    '- Uma página por ideia, com título curto e corpo em markdown que se entende sozinho, sem citar "a conversa".',
    '- Se uma página que já existe trata da mesma ideia, devolva o mesmo "path" para atualizá-la, com o texto completo.',
    '- Nunca copie senhas, tokens, chaves ou dados pessoais.',
    '- Para cada conversa, um resumo de 1 a 3 frases do que foi feito.',
    '- Se não houver nada durável, devolva "pages": [].',
    '',
    '## Resposta',
    'Só um bloco ```json, neste formato:',
    '```json',
    '{"pages":[{"type":"rule|gotcha|decision|concept","title":"...","body":"...","path":"(opcional, de uma página existente)"}],"sessions":[{"id":"<id da conversa>","title":"...","summary":"..."}]}',
    '```',
    ...(known.length ? ['', '## Páginas que já existem', ...known] : []),
    '',
    '## Conversas',
    ...parts,
  ].join('\n');
}

// The last ```json block (or the whole answer) -> pages to write. Throws when there is no usable JSON.
function parseConsolidationReply(reply, { sessionIds = [], existing = [] } = {}) {
  const src = String(reply || '');
  const blocks = [...src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  let data = null;
  for (const text of [...blocks.reverse(), src])
    try {
      data = JSON.parse(text.trim());
      break;
    } catch {}
  if (!data || typeof data !== 'object') throw new Error('A IA não devolveu a consolidação em JSON.');
  const known = new Set(existing.map((n) => n.path));
  const pages = (Array.isArray(data.pages) ? data.pages : [])
    .filter((p) => p && FOLDERS[p.type] && String(p.title || '').trim() && String(p.body || '').trim())
    .slice(0, MAX_PAGES)
    .map((p) => {
      const title = clip(redact(String(p.title).replace(/\s+/g, ' ').trim()), MAX_TITLE);
      const path = known.has(p.path) ? p.path : FOLDERS[p.type] + slug(title, 60, 'pagina') + '.md';
      return { path, title, body: clip(redact(String(p.body).trim()), MAX_BODY), kind: 'insight' };
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
  return { pages, sessions };
}

module.exports = { stretchText, batchesOf, buildConsolidationPrompt, parseConsolidationReply, FOLDERS };
