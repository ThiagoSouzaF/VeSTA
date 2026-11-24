// Mermaid diagrams in chat answers (```mermaid). The library loads only the first time a diagram shows up, renders
// with securityLevel 'strict' (no HTML labels, no click handlers) and its SVG is sanitized again before it reaches the
// page. A source that does not parse (or is still streaming) keeps showing as code.
import { sanitizeSvg } from './markdown';

let lib = null;
let seq = 0;
const done = new Map(); // theme|source -> svg ('' = does not parse)
const MAX = 200;

const dark = () => {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const m = bg.match(/^#([0-9a-f]{6})$/i);
  if (!m) return document.documentElement.dataset.theme !== 'paper';
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 < 128;
};

async function load() {
  if (!lib) lib = import('mermaid').then((m) => m.default);
  return lib;
}

export async function renderMermaid(source) {
  const theme = dark() ? 'dark' : 'neutral';
  const key = theme + '|' + source;
  if (done.has(key)) return done.get(key);
  const mermaid = await load();
  // Labels as SVG text: HTML labels live in a foreignObject, which the sanitizer removes.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    fontFamily: 'inherit',
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: true },
  });
  let svg = '';
  try {
    await mermaid.parse(source);
    svg = sanitizeSvg((await mermaid.render('vesta-mermaid-' + ++seq, source)).svg);
  } catch {
    // Leftovers of a failed render (mermaid adds its error box to the body).
    document.getElementById('dvesta-mermaid-' + seq)?.remove();
  }
  if (done.size >= MAX) done.clear();
  done.set(key, svg);
  return svg;
}

// Turns every diagram placeholder inside `root` into its picture (once).
export function drawDiagrams(root) {
  for (const fig of root.querySelectorAll('.md-mermaid[data-mermaid]:not([data-drawn])')) {
    fig.setAttribute('data-drawn', 'pending');
    renderMermaid(decodeURIComponent(fig.dataset.mermaid))
      .then((svg) => {
        if (!svg || !fig.isConnected) return fig.setAttribute('data-drawn', 'failed');
        fig.innerHTML = svg;
        fig.setAttribute('data-drawn', 'ok');
      })
      .catch(() => fig.setAttribute('data-drawn', 'failed'));
  }
}
