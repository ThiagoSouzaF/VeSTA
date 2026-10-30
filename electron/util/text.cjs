// Small text helpers shared by the main process.

// At most `n` characters of any value (null/undefined -> '').
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
// Same, but marks the cut with an ellipsis (the result never exceeds `max`).
const ellipsis = (v, max) => {
  const s = String(v == null ? '' : v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
// File and path names that work everywhere (Windows, Drive, phones): ASCII, lowercase, dashes.
const slug = (t, max = 60, fallback = 'sem-titulo') =>
  String(t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || fallback;
// The last non-empty line of a program's output (usually the error that matters).
const lastLine = (text) =>
  String(text || '')
    .trim()
    .split('\n')
    .pop() || '';
// Keeps the end of a growing buffer of output.
const tail = (buffer, chunk, max) => (buffer + chunk).slice(-max);

module.exports = { clip, ellipsis, slug, lastLine, tail };
