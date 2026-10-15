import React, {useEffect, useRef} from 'react';

// Animated backgrounds drawn behind the main area, in the colours of the current theme.
export const BACKDROPS = [
  {id: 'none', name: 'Liso', description: 'Só a cor do tema.'},
  {id: 'ember', name: 'Brasa', description: 'Fagulhas sobem devagar do centro.'},
  {id: 'rain', name: 'Chuva de código', description: 'Caracteres caem em colunas, bem de leve.'},
  {id: 'stream', name: 'Fluxo de texto', description: 'Palavras atravessam a tela devagar.'},
];
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789VeSTA{}<>=/*+:;'.split('');
const WORDS = ['memória', 'contexto', 'lar', 'chama', 'centro', 'agente', 'projeto', 'sessão', 'ideia', 'const', 'async', '=>', '{ }', 'fn()', 'import', 'git', 'VeSTA', 'claude', 'codex', 'opencode', 'foco', 'fogo', 'continuar', 'prompt', 'token', 'query', 'lareira', 'memory_query', 'await', 'return'];
const MONO = "'Cascadia Mono','Cascadia Code',Consolas,monospace";
const rand = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.random() * list.length | 0];
// Theme colours come as #rgb/#rrggbb custom properties; gradients need them with alpha.
function rgba(color, alpha) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const h = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`;
}

// Each scene: setup(w,h) builds its state, step(ctx,w,h,t) draws one frame. `fps` keeps them light on the CPU.
const SCENES = {
  rain: {
    fps: 18,
    setup(ctx, w, h, c) {
      const size = 15, colW = size * 1.3, rows = h / size;
      const drops = Array.from({length: Math.ceil(w / colW)}, () => ({y: rand(-rows, rows), speed: rand(.35, .8), on: Math.random() < .55}));
      ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      return {size, colW, rows, drops};
    },
    step(ctx, w, h, c, s) {
      // Painting the background translucent leaves fading trails behind each head.
      ctx.fillStyle = rgba(c.bg, .14); ctx.fillRect(0, 0, w, h);
      ctx.font = `${s.size}px ${MONO}`; ctx.textBaseline = 'top';
      s.drops.forEach((d, i) => {
        if (d.on && d.y >= 0) {
          ctx.fillStyle = rgba(c.accent, .85); ctx.fillText(pick(GLYPHS), i * s.colW, Math.floor(d.y) * s.size);
          if (Math.random() < .4) { ctx.fillStyle = rgba(c.muted, .5); ctx.fillText(pick(GLYPHS), i * s.colW, (Math.floor(d.y) - 1) * s.size); }
        }
        d.y += d.speed;
        if (d.y > s.rows && Math.random() < .04) { d.y = rand(-12, 0); d.on = Math.random() < .6; d.speed = rand(.35, .8); }
      });
    },
  },
  stream: {
    fps: 30,
    setup(ctx, w, h) {
      const gap = 54;
      const lines = Array.from({length: Math.ceil(h / gap) + 1}, (_, i) => {
        const text = Array.from({length: 18}, () => pick(WORDS)).join('   ·   ');
        return {y: i * gap + rand(-6, 6), text, x: rand(-2000, 0), speed: rand(.12, .5) * (i % 2 ? 1 : -1), size: rand(11, 14), alpha: rand(.08, .24), accent: Math.random() < .25};
      });
      return {lines, measured: false};
    },
    step(ctx, w, h, c, s) {
      ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h); ctx.textBaseline = 'middle';
      for (const l of s.lines) {
        ctx.font = `${l.size}px ${MONO}`;
        if (!l.width) l.width = ctx.measureText(l.text + '   ·   ').width;
        l.x = (l.x + l.speed) % l.width; if (l.x > 0) l.x -= l.width;
        ctx.fillStyle = rgba(l.accent ? c.accent : c.muted, l.alpha);
        for (let x = l.x; x < w; x += l.width) ctx.fillText(l.text, x, l.y);
      }
    },
  },
  ember: {
    fps: 30,
    setup(ctx, w, h) {
      const spawn = (fresh) => ({x: w / 2 + (Math.random() + Math.random() - 1) * w * .32, y: fresh ? rand(h * .2, h) : h + rand(0, 40), vy: rand(.25, .8), size: rand(1.5, 3.6), phase: rand(0, 6.3), warm: Math.random() < .5});
      return {spawn, sparks: Array.from({length: Math.round(Math.min(110, w * h / 9000))}, () => spawn(true))};
    },
    step(ctx, w, h, c, s, t) {
      ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
      // The hearth: a slow-breathing glow rising from the bottom centre.
      const pulse = .5 + .5 * Math.sin(t / 2600);
      const glow = ctx.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, Math.max(w, h) * .75);
      glow.addColorStop(0, rgba(c.warm, .16 + .05 * pulse)); glow.addColorStop(.45, rgba(c.accent, .07)); glow.addColorStop(1, rgba(c.accent, 0));
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
      s.sparks.forEach((p, i) => {
        p.y -= p.vy; p.x += Math.sin(t / 900 + p.phase) * .35;
        const life = Math.max(0, Math.min(1, p.y / h));
        ctx.fillStyle = rgba(p.warm ? c.warm : c.accent, .15 + .55 * life);
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        if (p.y < -10) s.sparks[i] = s.spawn(false);
      });
    },
  },
};

export function Backdrop({kind, theme, accent}) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current, scene = SCENES[kind];
    if (!canvas || !scene) return;
    const ctx = canvas.getContext('2d');
    let colors = null;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, state = null, raf = 0, last = 0;
    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1), box = canvas.getBoundingClientRect();
      // Read on every (re)start: the theme attributes are set by the parent's effect, which runs after this one.
      const css = getComputedStyle(document.documentElement), color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
      colors = {bg: color('--bg', '#111115'), accent: color('--accent', '#b3a0f5'), muted: color('--muted', '#95949f'), warm: color('--orange', '#d9a386')};
      w = Math.max(1, box.width); h = Math.max(1, box.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      state = scene.setup(ctx, w, h, colors);
      // With reduced motion the scene is advanced once into a settled, static frame.
      if (still) for (let i = 0; i < 90; i++) scene.step(ctx, w, h, colors, state, i * 40);
    };
    const frame = t => {
      raf = requestAnimationFrame(frame);
      if (!state || document.hidden || t - last < 1000 / scene.fps) return;
      last = t; scene.step(ctx, w, h, colors, state, t);
    };
    const observer = new ResizeObserver(() => state && resize());
    const start = setTimeout(() => { resize(); observer.observe(canvas); if (!still) raf = requestAnimationFrame(frame); }, 0);
    return () => { clearTimeout(start); cancelAnimationFrame(raf); observer.disconnect(); };
  }, [kind, theme, accent]);
  if (!SCENES[kind]) return null;
  return <canvas ref={ref} className={'backdrop ' + kind} aria-hidden="true"/>;
}
