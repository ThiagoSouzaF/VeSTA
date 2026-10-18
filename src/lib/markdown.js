import DOMPurify from 'dompurify';
import { marked } from 'marked';

const sanitizeHtml = (html) => DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'iframe'], FORBID_ATTR: ['style'] });
// html per block source text: while a reply streams, every block but the last one is identical from frame to
// frame, so it is rendered and sanitized once.
const cache = new Map();
// marked.lexer only honours `breaks` when given the full option set.
const options = { ...marked.defaults, breaks: true };
const CACHE_MAX = 3000;

// Markdown -> list of sanitized HTML strings, one per top-level block (paragraph, list, code, ...).
// Joined, they equal marked.parse(text, {breaks: true}).
export function markdownBlocks(text, sanitize = sanitizeHtml, store = cache) {
  const out = [];
  for (const token of marked.lexer(text || '', options)) {
    if (token.type === 'space') continue;
    let html = store.get(token.raw);
    if (html === undefined) {
      html = sanitize(marked.parser([token], options));
      if (store.size >= CACHE_MAX) store.clear();
      store.set(token.raw, html);
    }
    out.push(html);
  }
  return out;
}
