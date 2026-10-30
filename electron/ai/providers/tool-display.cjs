// How tool calls read in the UI: kind of card, label, detail line, and cleaning of result text.
const { clip } = require('../../util/text.cjs');
const { MEMORY_SERVER, QUEST_SERVER } = require('./mcp-servers.cjs');

const detailOf = (i) => i.command || i.file_path || i.path || i.pattern || i.url || i.query || i.description || '';
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// Tool name -> visual kind of the activity card.
function toolKind(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes(MEMORY_SERVER) || n.includes('vesta_memory')) return 'memory';
  if (n.startsWith('mcp__') || n.startsWith('mcp_')) return 'mcp';
  if (n === 'monitor') return 'monitor';
  if (/^(bash|shell|powershell|command|exec|run$)/.test(n)) return 'command';
  if (/^(read|write|edit|multiedit|notebookedit|patch|apply_patch|file)/.test(n)) return 'file';
  if (/^(grep|glob|list|ls|find|search|toolsearch)/.test(n)) return 'search';
  if (/^(web|fetch|browser)/.test(n)) return 'web';
  if (/^(todo|task_?create|task_?update)/.test(n)) return 'todo';
  return 'tool';
}
// Memory tools read as "Memória · memory_query" instead of the raw MCP-qualified name.
const questTool = (n) => new RegExp(QUEST_SERVER + '_+([\\w-]+)$').exec(n)?.[1];
const toolLabel = (name) => {
  const n = String(name || '');
  if (questTool(n)) return 'Quest · ' + questTool(n);
  if (toolKind(n) !== 'memory') return 'Usando ' + n;
  const i = n.lastIndexOf('memory_'),
    tool = i >= 0 ? n.slice(i) : n;
  return 'Memória · ' + tool;
};
const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c
          .map((x) => (typeof x === 'string' ? x : x?.text || ''))
          .filter(Boolean)
          .join('\n')
      : c && c.text
        ? c.text
        : '';
// Strips the harness frame Claude Code wraps around a subagent report and its per-line indentation.
const unframe = (s) => {
  const m = /The report follows:\s*\n/i.exec(s);
  if (!m) return s;
  return s
    .slice(m.index + m[0].length)
    .split('\n')
    .map((l) => l.replace(/^ {2}/, ''))
    .join('\n');
};
const summarize = (v) => clip(unframe(textOf(v).replace(/^\s*\[Subagent hand-back\]\s*/i, '')).trim(), 4000);
module.exports = { detailOf, num, toolKind, toolLabel, textOf, unframe, summarize };
