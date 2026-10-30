import { useEffect, useRef } from 'react';
import { frameDue, nextLast, resolveScene } from '../lib/backdropRain';
import { SCENES } from '../lib/backdropScenes';

// Animated backgrounds drawn behind the main area, in the colours of the current theme.
export const BACKDROPS = [
  { id: 'none', name: 'Liso', description: 'Só a cor do tema.' },
  { id: 'ember', name: 'Brasa', description: 'Fagulhas sobem devagar do centro.' },
  { id: 'rain', name: 'Chuva de código', description: 'Caracteres caem em colunas, bem de leve.' },
  {
    id: 'inkrain',
    name: 'Chuva em tinta',
    description: 'Filme antigo e mangá impresso: granulação, vinheta e chuva em tons de cinza.',
  },
  { id: 'stream', name: 'Fluxo de texto', description: 'Palavras atravessam a tela devagar.' },
];
// Film-style layers over the ink rain: all CSS, all on the compositor (grain jumps, flicker, scratches, vignette).
function Film() {
  const ref = useRef(null);
  useEffect(() => {
    // Nothing animates while the window is hidden or minimised.
    const sync = () => ref.current && (ref.current.dataset.paused = String(document.hidden));
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return (
    <div ref={ref} className="backdrop-film" aria-hidden="true">
      <i className="film-grain" />
      <i className="film-flicker" />
      <i className="film-scratch" />
      <i className="film-vignette" />
    </div>
  );
}

export function Backdrop({ kind, theme, accent }) {
  const ref = useRef(null);
  const sceneId = resolveScene(kind, theme);
  useEffect(() => {
    const canvas = ref.current,
      scene = SCENES[sceneId];
    if (!canvas || !scene) return;
    const ctx = canvas.getContext('2d');
    let colors = null;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0,
      h = 0,
      state = null,
      raf = 0,
      last = 0;
    const resize = () => {
      const dpr = scene.dpr || Math.min(1.5, window.devicePixelRatio || 1),
        box = canvas.getBoundingClientRect();
      // Read on every (re)start: the theme attributes are set by the parent's effect, which runs after this one.
      const css = getComputedStyle(document.documentElement),
        color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
      colors = {
        bg: color('--bg', '#111115'),
        accent: color('--accent', '#b3a0f5'),
        muted: color('--muted', '#95949f'),
        faint: color('--faint', '#646370'),
        text: color('--text', '#e9e8ec'),
        warm: color('--orange', '#d9a386'),
      };
      w = Math.max(1, box.width);
      h = Math.max(1, box.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      state = scene.setup(ctx, w, h, colors);
      // With reduced motion the scene is advanced once into a settled, static frame.
      if (still) for (let i = 0; i < 90; i++) scene.step(ctx, w, h, colors, state, i * 40);
    };
    const frame = (t) => {
      raf = requestAnimationFrame(frame);
      if (!state || document.hidden || !frameDue(t, last, scene.fps)) return;
      last = nextLast(t, last, scene.fps);
      scene.step(ctx, w, h, colors, state, t);
    };
    const observer = new ResizeObserver(() => state && resize());
    const start = setTimeout(() => {
      resize();
      observer.observe(canvas);
      if (!still) raf = requestAnimationFrame(frame);
    }, 0);
    return () => {
      clearTimeout(start);
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [sceneId, theme, accent]);
  if (!SCENES[sceneId]) return null;
  return (
    <>
      <canvas ref={ref} className={'backdrop ' + sceneId} aria-hidden="true" />
      {sceneId === 'inkrain' && <Film />}
    </>
  );
}
