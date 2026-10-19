// Pure tuning of the code-rain backdrop: which scene a setting maps to, how fast the drops fall and how often a frame is drawn.
// Kept free of DOM and timers so it can be tested (test/backdrop.test.cjs).

// Speeds are in rows per second, so the pace does not depend on the frame rate.
// The classic rain moved 0.35..0.8 rows per frame at 18 fps; the film-style ink rain runs at about half of that,
// and at 24 fps, the cadence of an old film projector.
export const RAIN = {
  classic: { fps: 18, speed: [6.3, 14.4], trail: 1 },
  ink: { fps: 24, speed: [3.2, 7.2], trail: 16 },
};
// A frame that arrives late (a throttled tab, a long GC) never makes the drops jump.
export const MAX_FRAME_MS = 100;

// The ink theme draws its "Chuva de código" as the film-style rain; any theme can also pick it directly.
export function resolveScene(kind, theme) {
  if (kind === 'rain' && theme === 'ink') return 'inkrain';
  return kind;
}

export const rainProfile = (scene) => (scene === 'inkrain' ? RAIN.ink : RAIN.classic);

// Minimum time between two drawn frames.
export const frameInterval = (fps) => 1000 / fps;
export const frameDue = (now, last, fps) => now - last >= frameInterval(fps) - 1;
// The timestamp to remember after drawing a frame at `now`: the late part of the interval is carried over, so a 60 Hz
// screen alternates 2 and 3 vsyncs and averages the target rate instead of settling on 20 fps.
export const nextLast = (now, last, fps) =>
  last + Math.max(1, Math.round((now - last) / frameInterval(fps))) * frameInterval(fps);

// Moves a drop by `dtMs` of real time.
export const advance = (row, speed, dtMs) => row + (speed * Math.min(Math.max(dtMs, 0), MAX_FRAME_MS)) / 1000;

// Random speed inside a profile's range (rand is injectable for tests).
export const dropSpeed = (profile, rand = Math.random) =>
  profile.speed[0] + rand() * (profile.speed[1] - profile.speed[0]);

// Posterised ink levels: the head is solid paper white, the trail steps down through printed grey tones.
// Returns 0 (head) .. levels-1 (faintest), or -1 when the glyph is past the end of the trail.
export function trailLevel(k, trail, levels = 4) {
  if (k < 0 || k >= trail) return -1;
  if (k === 0) return 0;
  return Math.min(levels - 1, 1 + Math.floor(((k - 1) / (trail - 1)) * (levels - 1)));
}
