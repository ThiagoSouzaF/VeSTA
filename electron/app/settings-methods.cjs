// Settings of the renderer API: validates every field before it reaches the store.
const { THEMES } = require('./store.cjs');
const follow = require('../chat/follow.cjs');
// Text zoom: 80%..160% in steps of 10%.
const clampFontScale = (v) => Math.min(1.6, Math.max(0.8, Math.round(v * 10) / 10));
function settingsMethods(ctx) {
  const { sync, state } = ctx;
  return {
    saveSettings: (input) => {
      const s = ctx.store.state.settings;
      if (THEMES.includes(input.theme)) s.theme = input.theme;
      if (['ember', 'violet', 'mint', 'amber', 'rose'].includes(input.accent)) s.accent = input.accent;
      if (['none', 'ember', 'rain', 'inkrain', 'stream'].includes(input.background)) s.background = input.background;
      if (Number.isFinite(input.fontScale)) s.fontScale = clampFontScale(input.fontScale);
      if (input.followMinutes !== undefined || input.followMax !== undefined) {
        const l = follow.limits({
          followMinutes: input.followMinutes ?? s.followMinutes,
          followMax: input.followMax ?? s.followMax,
        });
        s.followMinutes = l.minutes;
        s.followMax = l.maxChats;
      }
      for (const key of [
        'memoryEnabled',
        'capture',
        'captureRaw',
        'memoryTools',
        'mascot',
        'chatSettings',
        'autoUpdate',
      ])
        if (typeof input[key] === 'boolean') s[key] = input[key];
      // The server always has the LLM configured; this only decides whether the app asks for consolidations.
      if (['codex', 'off'].includes(input.memoryConsolidate)) s.memoryConsolidate = input.memoryConsolidate;
      ctx.store.save();
      sync();
      return state();
    },
  };
}
module.exports = { settingsMethods, clampFontScale };
