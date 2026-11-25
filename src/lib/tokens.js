// Tokens of a conversation and of each answer (pure). Every AI reports the same shape (electron/ai/usage.cjs):
// inputTokens is the fresh input, cacheTokens what came from (or went to) the prompt cache, outputTokens everything
// the AI wrote, thinking included; costUsd is the API list price the CLI computed, when it does.

export const fmtTokens = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0));
export const fmtCost = (n) => (n > 0 ? '$' + n.toFixed(n < 1 ? 3 : 2) : '—');

const KEYS = ['inputTokens', 'outputTokens', 'cacheTokens', 'costUsd'];
export const totalTokens = (t) => (t ? (t.inputTokens || 0) + (t.cacheTokens || 0) + (t.outputTokens || 0) : 0);

// The chat's answers added up: { inputTokens, outputTokens, cacheTokens, costUsd, counted, answers } (counted: answers
// with a count; older ones, from before the count existed, have none).
export function chatTokens(chat) {
  const out = { inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0, counted: 0, answers: 0 };
  for (const m of chat?.messages || []) {
    if (m.role !== 'assistant') continue;
    out.answers++;
    if (!m.usage) continue;
    out.counted++;
    for (const k of KEYS) out[k] += Number(m.usage[k]) || 0;
  }
  return out;
}

// "12.3k tokens"
export const tokensLabel = (t) => fmtTokens(totalTokens(t)) + ' tokens';

// The parts, for a tooltip or a list: [[label, value]].
export function tokenParts(t) {
  const parts = [
    ['Entrada nova', fmtTokens(t.inputTokens || 0)],
    ['Do cache', fmtTokens(t.cacheTokens || 0)],
    ['Saída (com o raciocínio)', fmtTokens(t.outputTokens || 0)],
  ];
  if (t.costUsd > 0) parts.push(['Preço na API', fmtCost(t.costUsd)]);
  return parts;
}
export const tokensTitle = (t) =>
  tokensLabel(t) +
  ' nesta resposta: ' +
  tokenParts(t)
    .map(([k, v]) => k.toLowerCase() + ' ' + v)
    .join(', ') +
  '.';
