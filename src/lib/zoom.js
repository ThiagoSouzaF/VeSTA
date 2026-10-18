// Text zoom: a factor between 80% and 160% in steps of 10%, applied through the --font-scale CSS variable.
export const SCALE_MIN = 0.8,
  SCALE_MAX = 1.6,
  SCALE_STEP = 0.1;
export const clampScale = (v) => {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(n * 10) / 10));
};
// dir: 1 bigger, -1 smaller, 0 back to 100%.
export const stepScale = (current, dir) => (dir === 0 ? 1 : clampScale(clampScale(current) + dir * SCALE_STEP));
export const scalePercent = (v) => Math.round(clampScale(v) * 100) + '%';
// Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 (also the numpad) -> 1 | -1 | 0, otherwise null.
export function zoomKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === '=' || e.key === '+' || e.key === 'Add') return 1;
  if (e.key === '-' || e.key === '_' || e.key === 'Subtract') return -1;
  if (e.key === '0') return 0;
  return null;
}
// Ctrl + wheel: up zooms in, down zooms out.
export const zoomWheel = (e) => (e.ctrlKey && e.deltaY ? (e.deltaY < 0 ? 1 : -1) : null);
