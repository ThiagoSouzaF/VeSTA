// The canvas scenes behind the main area: static glyph/word lists, colour helper and one setup/step pair per scene.
import { RAIN, advance, dropSpeed, trailLevel } from './backdropRain';

const GLYPHS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789VeSTA{}<>=/*+:;'.split(
    ''
  );
// The ink rain is monochrome and calm: katakana, digits and a few code marks, like a printed page.
const INK_GLYPHS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789{}<>=/+:;'.split(
    ''
  );
const INK_FONT = "'Space Mono','Yu Gothic','MS Gothic',monospace";
const WORDS = [
  'memória',
  'contexto',
  'lar',
  'chama',
  'centro',
  'agente',
  'projeto',
  'sessão',
  'ideia',
  'const',
  'async',
  '=>',
  '{ }',
  'fn()',
  'import',
  'git',
  'VeSTA',
  'claude',
  'codex',
  'opencode',
  'foco',
  'fogo',
  'continuar',
  'prompt',
  'token',
  'query',
  'lareira',
  'memory_query',
  'await',
  'return',
];
const MONO = "'Cascadia Mono','Cascadia Code',Consolas,monospace";
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[(Math.random() * list.length) | 0];
// Theme colours come as #rgb/#rrggbb custom properties; gradients need them with alpha.
function rgba(color, alpha) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const h =
    hex[1].length === 3
      ? hex[1]
          .split('')
          .map((c) => c + c)
          .join('')
      : hex[1];
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`;
}

// Each scene: setup(w,h) builds its state, step(ctx,w,h,t) draws one frame. `fps` keeps them light on the CPU.
export const SCENES = {
  rain: {
    fps: 18,
    setup(ctx, w, h, c) {
      const size = 15,
        colW = size * 1.3,
        rows = h / size;
      const drops = Array.from({ length: Math.ceil(w / colW) }, () => ({
        y: rand(-rows, rows),
        speed: rand(0.35, 0.8),
        on: Math.random() < 0.55,
      }));
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, w, h);
      return { size, colW, rows, drops };
    },
    step(ctx, w, h, c, s) {
      // Painting the background translucent leaves fading trails behind each head.
      ctx.fillStyle = rgba(c.bg, 0.14);
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${s.size}px ${MONO}`;
      ctx.textBaseline = 'top';
      s.drops.forEach((d, i) => {
        if (d.on && d.y >= 0) {
          ctx.fillStyle = rgba(c.accent, 0.85);
          ctx.fillText(pick(GLYPHS), i * s.colW, Math.floor(d.y) * s.size);
          if (Math.random() < 0.4) {
            ctx.fillStyle = rgba(c.muted, 0.5);
            ctx.fillText(pick(GLYPHS), i * s.colW, (Math.floor(d.y) - 1) * s.size);
          }
        }
        d.y += d.speed;
        if (d.y > s.rows && Math.random() < 0.04) {
          d.y = rand(-12, 0);
          d.on = Math.random() < 0.6;
          d.speed = rand(0.35, 0.8);
        }
      });
    },
  },
  // Old film / printed manga: grey katakana falling at half the speed of the classic rain, on a transparent canvas
  // (the screentone, grain, flicker and vignette are CSS layers, see Film below). Rebuilt every frame from state, so
  // there is no ghosting and no per-frame allocation beyond four small lists.
  inkrain: {
    fps: RAIN.ink.fps,
    dpr: 1,
    setup(ctx, w, h) {
      const profile = RAIN.ink,
        size = 14,
        colW = size * 1.45,
        rows = Math.ceil(h / size),
        cols = Math.ceil(w / colW);
      // The conversation spans almost the whole main area, so the calm band is wide and nearly empty: rain lives at the edges.
      const calm = (i) => Math.abs((i + 0.5) / cols - 0.5) < 0.4;
      const drops = Array.from({ length: cols }, (_, i) => ({
        y: rand(-rows, rows),
        speed: dropSpeed(profile),
        on: Math.random() < (calm(i) ? 0.06 : 0.55),
        dim: calm(i) ? 0.35 : 1,
        chars: Array.from({ length: 48 }, () => pick(INK_GLYPHS)),
      }));
      return { size, colW, rows, drops, profile, calm, last: 0, levels: [[], [], [], []] };
    },
    step(ctx, w, h, c, s, t) {
      const dt = s.last ? t - s.last : 1000 / s.profile.fps;
      s.last = t;
      ctx.clearRect(0, 0, w, h);
      ctx.font = `${s.size}px ${INK_FONT}`;
      ctx.textBaseline = 'top';
      for (const list of s.levels) list.length = 0;
      s.drops.forEach((d, i) => {
        if (d.on) {
          const head = Math.floor(d.y);
          for (let k = 0; k < s.profile.trail; k++) {
            const row = head - k,
              level = trailLevel(k, s.profile.trail);
            if (row < 0 || row > s.rows || level < 0) continue;
            s.levels[level].push(i * s.colW, row * s.size, d.chars[((row % 48) + 48) % 48], d.dim);
          }
          if (Math.random() < 0.06) d.chars[(Math.random() * 48) | 0] = pick(INK_GLYPHS);
        }
        d.y = advance(d.y, d.speed, dt);
        if (d.y - s.profile.trail > s.rows && Math.random() < 0.05) {
          d.y = rand(-14, 0);
          d.speed = dropSpeed(s.profile);
          d.on = Math.random() < (s.calm(i) ? 0.06 : 0.6);
        }
      });
      // Four ink tones, drawn level by level so the fill style changes four times per frame.
      const tones = [
        [c.text, 0.95],
        [c.text, 0.5],
        [c.muted, 0.42],
        [c.faint, 0.34],
      ];
      s.levels.forEach((list, level) => {
        ctx.fillStyle = tones[level][0];
        for (let n = 0; n < list.length; n += 4) {
          ctx.globalAlpha = tones[level][1] * list[n + 3];
          ctx.fillText(list[n + 2], list[n], list[n + 1]);
        }
      });
      ctx.globalAlpha = 1;
    },
  },
  stream: {
    fps: 30,
    setup(ctx, w, h) {
      const gap = 54;
      const lines = Array.from({ length: Math.ceil(h / gap) + 1 }, (_, i) => {
        const text = Array.from({ length: 18 }, () => pick(WORDS)).join('   ·   ');
        return {
          y: i * gap + rand(-6, 6),
          text,
          x: rand(-2000, 0),
          speed: rand(0.12, 0.5) * (i % 2 ? 1 : -1),
          size: rand(11, 14),
          alpha: rand(0.08, 0.24),
          accent: Math.random() < 0.25,
        };
      });
      return { lines };
    },
    step(ctx, w, h, c, s) {
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.textBaseline = 'middle';
      for (const l of s.lines) {
        ctx.font = `${l.size}px ${MONO}`;
        if (!l.width) l.width = ctx.measureText(l.text + '   ·   ').width;
        l.x = (l.x + l.speed) % l.width;
        if (l.x > 0) l.x -= l.width;
        ctx.fillStyle = rgba(l.accent ? c.accent : c.muted, l.alpha);
        for (let x = l.x; x < w; x += l.width) ctx.fillText(l.text, x, l.y);
      }
    },
  },
  ember: {
    fps: 30,
    setup(ctx, w, h) {
      const spawn = (fresh) => ({
        x: w / 2 + (Math.random() + Math.random() - 1) * w * 0.32,
        y: fresh ? rand(h * 0.2, h) : h + rand(0, 40),
        vy: rand(0.25, 0.8),
        size: rand(1.5, 3.6),
        phase: rand(0, 6.3),
        warm: Math.random() < 0.5,
      });
      return { spawn, sparks: Array.from({ length: Math.round(Math.min(110, (w * h) / 9000)) }, () => spawn(true)) };
    },
    step(ctx, w, h, c, s, t) {
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, w, h);
      // The hearth: a slow-breathing glow rising from the bottom centre.
      const pulse = 0.5 + 0.5 * Math.sin(t / 2600);
      const glow = ctx.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, Math.max(w, h) * 0.75);
      glow.addColorStop(0, rgba(c.warm, 0.16 + 0.05 * pulse));
      glow.addColorStop(0.45, rgba(c.accent, 0.07));
      glow.addColorStop(1, rgba(c.accent, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      s.sparks.forEach((p, i) => {
        p.y -= p.vy;
        p.x += Math.sin(t / 900 + p.phase) * 0.35;
        const life = Math.max(0, Math.min(1, p.y / h));
        ctx.fillStyle = rgba(p.warm ? c.warm : c.accent, 0.15 + 0.55 * life);
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        if (p.y < -10) s.sparks[i] = s.spawn(false);
      });
    },
  },
};
