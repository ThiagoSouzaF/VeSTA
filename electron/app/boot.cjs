// Real boot progress, shared by the main process and the splash window. Pure: no electron, no timers.
// Each stage is completed by the work it names (store read, memory server answering, integrations probed, renderer
// loaded its first state), so the bar only moves when something has actually happened.

// Stages run concurrently and finish in any order; `weight` is each one's share of the bar (sums to 100).
const STAGES = [
  { id: 'data', label: 'CARREGANDO DADOS', weight: 15 },
  { id: 'memory', label: 'INICIANDO MEMÓRIA', weight: 30 },
  { id: 'ias', label: 'PROCURANDO IAS', weight: 25 },
  { id: 'ui', label: 'ABRINDO A INTERFACE', weight: 30 },
];
const READY_LABEL = 'PRONTO';
// The splash never disappears faster than this, so a quick boot does not look like a flicker.
const MIN_SPLASH_MS = 1200;
// A boot that takes longer than this is reported instead of hanging on the splash.
const BOOT_TIMEOUT_MS = 30000;

// What the splash shows for a set of finished stages. The label is the first unfinished stage, in order.
function snapshot(done, error = null) {
  const finished = new Set(done);
  const percent = STAGES.reduce((sum, s) => sum + (finished.has(s.id) ? s.weight : 0), 0);
  const current = STAGES.find((s) => !finished.has(s.id));
  return {
    percent,
    label: error ? 'ERRO' : current ? current.label : READY_LABEL,
    steps: STAGES.map((s) => ({ id: s.id, done: finished.has(s.id) })),
    complete: !current,
    error: error ? { message: String(error.message || error), canContinue: !!error.canContinue } : null,
  };
}

// Milliseconds still to wait before the splash may hand over to the main window (0 = go now).
function splashRemaining(shownAt, now, minMs = MIN_SPLASH_MS) {
  if (!shownAt) return minMs;
  return Math.max(0, minMs - (now - shownAt));
}

// The main window is revealed only when everything is ready AND the splash has been up long enough.
function mayReveal({ complete, mainReady, shownAt, now, minMs = MIN_SPLASH_MS }) {
  return !!complete && !!mainReady && splashRemaining(shownAt, now, minMs) === 0;
}

// Tracks finished stages and tells `onChange` the new snapshot. Completing a stage twice changes nothing.
function createBoot({ onChange = () => {} } = {}) {
  const done = new Set();
  let error = null;
  const emit = () => onChange(snapshot(done, error));
  return {
    complete(id) {
      if (!STAGES.some((s) => s.id === id) || done.has(id) || error) return;
      done.add(id);
      emit();
    },
    fail(message, { canContinue = false } = {}) {
      if (error) return;
      error = { message, canContinue };
      emit();
    },
    snapshot: () => snapshot(done, error),
    allDone: () => STAGES.every((s) => done.has(s.id)),
    isDone: (id) => done.has(id),
    failed: () => !!error,
  };
}

module.exports = {
  STAGES,
  READY_LABEL,
  MIN_SPLASH_MS,
  BOOT_TIMEOUT_MS,
  snapshot,
  splashRemaining,
  mayReveal,
  createBoot,
};
