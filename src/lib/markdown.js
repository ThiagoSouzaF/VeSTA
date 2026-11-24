import DOMPurify from 'dompurify';
import { marked } from 'marked';

const sanitizeHtml = (html) => DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'iframe'], FORBID_ATTR: ['style'] });
// Pictures the AI draws: SVG only, nothing that loads or runs (no external image, no embedded HTML, no script).
const SVG_FORBID = ['image', 'foreignObject', 'script', 'use', 'a', 'animate', 'set', 'animateMotion'];
export const sanitizeSvg = (svg) =>
  DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: SVG_FORBID,
    FORBID_ATTR: ['href', 'xlink:href'],
  });
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// html per block source text: while a reply streams, every block but the last one is identical from frame to
// frame, so it is rendered and sanitized once.
const cache = new Map();
// marked.lexer only honours `breaks` when given the full option set.
const options = { ...marked.defaults, breaks: true };
const CACHE_MAX = 3000;

// ```svg -> the picture itself (sanitized); ```mermaid -> a placeholder the Markdown component turns into a diagram
// (its source stays visible as code until then, and when it does not parse). Anything else: regular markdown.
function renderToken(token, sanitize, svgSanitize) {
  if (token.type === 'code' && /^svg$/i.test(token.lang || '') && /<svg[\s>]/i.test(token.text)) {
    const svg = svgSanitize(token.text);
    if (svg.trim()) return '<figure class="md-figure md-svg">' + svg + '</figure>';
  }
  if (token.type === 'code' && /^mermaid$/i.test(token.lang || ''))
    return (
      '<figure class="md-figure md-mermaid" data-mermaid="' +
      encodeURIComponent(token.text) +
      '"><pre><code>' +
      escapeHtml(token.text) +
      '</code></pre></figure>'
    );
  return sanitize(marked.parser([token], options));
}

// Markdown -> list of sanitized HTML strings, one per top-level block (paragraph, list, code, ...).
// Joined, they equal marked.parse(text, {breaks: true}) (but for the svg and mermaid figures).
export function markdownBlocks(text, sanitize = sanitizeHtml, store = cache, svgSanitize = sanitizeSvg) {
  const out = [];
  for (const token of marked.lexer(text || '', options)) {
    if (token.type === 'space') continue;
    let html = store.get(token.raw);
    if (html === undefined) {
      html = renderToken(token, sanitize, svgSanitize);
      if (store.size >= CACHE_MAX) store.clear();
      store.set(token.raw, html);
    }
    out.push(html);
  }
  return out;
}
