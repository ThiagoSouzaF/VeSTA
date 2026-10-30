import { MODEL_LABELS } from './constants';
export const formatDate = (n) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(n);
export const formatElapsed = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
};
export const fmtTokens = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0));
export const fmtCost = (n) => (n > 0 ? '$' + n.toFixed(n < 1 ? 3 : 2) : '—');
export const formatReset = (ms, now) => {
  if (!ms) return 'sem horário de reset';
  const d = ms - now;
  if (d <= 0) return 'janela já reiniciada';
  const m = Math.floor(d / 60000),
    h = Math.floor(m / 60);
  return (
    'reseta em ' +
    (h >= 24 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h + 'h ' + String(m % 60).padStart(2, '0') + 'm')
  );
};
export const modelLabel = (m) => (m ? MODEL_LABELS[m] || m : 'Padrão da conta');
// Short pt-BR date and time ("29/10/2026 14:05"); `fallback` is shown when there is no timestamp.
export const formatDateTime = (t, fallback = '') =>
  t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : fallback;
export const formatBytes = (n) =>
  n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
