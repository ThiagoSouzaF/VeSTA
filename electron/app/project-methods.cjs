// Project operations of the renderer API: add, open in the file manager, and the instruction files (AGENTS.md...) the AIs read.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { randomUUID } = require('node:crypto');
const { UserError } = require('./errors.cjs');
// Instruction files each AI reads, and who reads them (shown next to the file so the list explains itself).
const READERS = {
  'AGENTS.md': 'Codex, OpenCode e Drael',
  'AGENTS.override.md': 'Codex',
  'CLAUDE.md': 'Claude',
  '.claude/CLAUDE.md': 'Claude',
  'opencode.json': 'OpenCode',
  'opencode.jsonc': 'OpenCode',
};
// The instruction files that apply to a project: in its folder, in the folders above it, and the global ones.
// -> [{ name, path }] where name says where the file is and which AI reads it.
async function inspectProject(ctx, id) {
  const p = ctx.project(id);
  if (!p) return [];
  const home = os.homedir();
  const globals = new Map([
    [path.join(home, '.codex', 'AGENTS.md'), 'Codex · instruções globais'],
    [path.join(home, '.claude', 'CLAUDE.md'), 'Claude · instruções globais'],
    [path.join(home, '.config', 'opencode', 'AGENTS.md'), 'OpenCode · instruções globais'],
  ]);
  const files = [],
    seen = new Set();
  const add = (file, name) => {
    if (!seen.has(file) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      seen.add(file);
      files.push({ name, path: file });
    }
  };
  let dir = p.path;
  for (let i = 0; i < 20; i++) {
    for (const name of Object.keys(READERS)) {
      const file = path.join(dir, name);
      const where = dir === p.path ? name : name + ' em ' + (path.basename(dir) || dir);
      add(file, globals.get(file) || where + ' · ' + READERS[name]);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const [file, label] of globals) add(file, label);
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
