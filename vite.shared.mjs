// electron/shared/tasks.cjs, quests.cjs, agents.cjs, refine.cjs and skills.cjs are pure and shared with the renderers (desktop and phone): expose their
// module.exports as the default ES export.
export const sharedCjs = () => ({
  name: 'vesta-shared-cjs',
  enforce: 'pre',
  transform(code, id) {
    if (!/electron[\/]shared[\/](tasks|quests|agents|refine|skills|teams)\.cjs$/.test(id.split('?')[0])) return null;
    return {
      code:
        'const module = { exports: {} };\nconst exports = module.exports;\n' +
        code +
        '\nexport default module.exports;\n',
      map: null,
    };
  },
});
