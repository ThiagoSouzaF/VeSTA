// Project operations of the renderer API: add, open in the file manager, and the instruction files (AGENTS.md...) the AIs read.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { randomUUID } = require('node:crypto');
const { UserError } = require('./errors.cjs');
async function inspectProject(ctx, id) {
  const p = ctx.project(id);
  if (!p) return [];
  const files = [],
    seen = new Set();
  const add = (base, name, label) => {
    const file = path.join(base, name);
    if (!seen.has(file) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      seen.add(file);
      files.push({ name: label || name, path: file });
    }
  };
  let dir = p.path;
  for (let i = 0; i < 20; i++) {
    for (const name of [
      'AGENTS.md',
      'AGENTS.override.md',
      'CLAUDE.md',
      '.claude/CLAUDE.md',
      'opencode.json',
      'opencode.jsonc',
    ])
      add(dir, name);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  add(path.join(os.homedir(), '.codex'), 'AGENTS.md', 'Codex · instruções globais');
  add(path.join(os.homedir(), '.claude'), 'CLAUDE.md', 'Claude · instruções globais');
  add(path.join(os.homedir(), '.config', 'opencode'), 'AGENTS.md', 'OpenCode · instruções globais');
  return files;
}
function projectMethods(ctx) {
  const { project, sync } = ctx;
  return {
    addProject: async () => {
      const result = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Escolher projeto',
        properties: ['openDirectory'],
      });
      if (result.canceled) return null;
      const dir = fs.realpathSync(result.filePaths[0]);
      let p = ctx.store.state.projects.find((p) => p.path.toLowerCase() === dir.toLowerCase());
      if (!p) {
        p = { id: randomUUID(), name: path.basename(dir), path: dir, createdAt: Date.now() };
        ctx.store.state.projects.push(p);
        ctx.store.save();
        sync();
      }
      return p;
    },
    inspectProject: ({ id }) => inspectProject(ctx, id),
    openProject: ({ id }) => {
      const p = project(id);
      if (!p) throw new UserError('Projeto inválido');
      return ctx.shell.openPath(p.path);
    },
    openInstructions: async ({ projectId, file }) => {
      const allowed = await inspectProject(ctx, projectId);
      if (!allowed.some((x) => x.path === file)) throw new UserError('Arquivo não autorizado');
      return ctx.shell.openPath(file);
    },
  };
}
module.exports = { projectMethods };
