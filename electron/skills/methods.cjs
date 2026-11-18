// IPC surface of Skills: thin wrappers over the engine (skills/engine.cjs). Changes answer with the new state.
function skillMethods(ctx) {
  const S = () => ctx.skills;
  const withState = (fn) => async (args) => {
    const result = await fn(args || {});
    return { result, state: ctx.state() };
  };
  return {
    skillsNative: () => S().nativeList(),
    skillsRead: ({ name } = {}) => S().read(String(name || '')),
    skillsSet: withState(({ name, ...patch }) => S().set(String(name || ''), patch)),
    skillsRemove: withState(({ name }) => S().remove(String(name || ''))),
    // kind 'file' opens the dialog here: the screen never sends a path of its own.
    skillsScan: async (args = {}) => {
      if (args.kind === 'file') {
        const r = await ctx.dialog.showOpenDialog(ctx.win, {
          title: 'Escolher skill (SKILL.md, .md ou pasta)',
          properties: [args.folder ? 'openDirectory' : 'openFile'],
          filters: args.folder ? undefined : [{ name: 'Skill', extensions: ['md', 'markdown', 'txt'] }],
        });
        if (r.canceled || !r.filePaths[0]) return null;
        return S().scan({ kind: 'path', path: r.filePaths[0] });
      }
      if (!['paste', 'github', 'native'].includes(args.kind)) return null;
      return S().scan({ kind: args.kind, text: args.text, url: args.url, dir: args.dir });
    },
    skillsKeep: withState((a) => S().keep(a)),
    skillsAdapt: withState((a) => S().adapt(a)),
    skillsRedo: withState(({ id, provider, model }) => S().redo(id, { provider, model })),
    skillsDraftRead: ({ id } = {}) => S().draftRead(id),
    skillsDraftUpdate: withState(({ id, ...patch }) => S().draftUpdate(id, patch)),
    skillsSaveDrafts: withState((a) => S().saveDrafts(a)),
    skillsDiscard: withState(({ ids }) => S().discard(ids)),
  };
}
module.exports = { skillMethods };
