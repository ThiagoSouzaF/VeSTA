// Git for Equipes: one worktree (and branch) per agent that edits, so nobody steps on anybody's files, and the merge the
// person approves. Every command runs in a folder VeSTA was given (the project) or created (<userData>/teams).
// deps (tests): { run(exe, args, options) }
const fs = require('node:fs');
const path = require('node:path');
const { UserError } = require('../app/errors.cjs');

function createTeamGit({ run = require('../util/proc.cjs').run } = {}) {
  const git = (cwd, args, timeout = 60000) => run('git', ['-C', cwd, ...args], { timeout });
  const isRepo = (dir) =>
    git(dir, ['rev-parse', '--is-inside-work-tree'])
      .then((o) => o.trim() === 'true')
      .catch(() => false);
  const branchExists = (dir, branch) =>
    git(dir, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch])
      .then(() => true)
      .catch(() => false);
  // The agent's folder: reused when it is already there, else added from the project's current commit.
  async function ensureWorktree(project, dir, branch) {
    if (fs.existsSync(path.join(dir, '.git'))) return { dir, branch };
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (await branchExists(project, branch)) await git(project, ['worktree', 'add', dir, branch]);
    else await git(project, ['worktree', 'add', '-b', branch, dir]);
    return { dir, branch };
  }
  async function removeWorktree(project, dir) {
    await git(project, ['worktree', 'remove', '--force', dir]).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
    await git(project, ['worktree', 'prune']).catch(() => {});
  }
  const clean = async (dir) => !(await git(dir, ['status', '--porcelain'])).trim();
  const current = async (dir) => (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  // Joins the agent's branch into the branch the project is on. Only with nothing pending on either side; a conflict is
  // undone and reported, never left half-way.
  async function merge(project, worktree, branch) {
    if (!(await clean(project)))
      throw new UserError('O projeto tem mudanças sem commit. Salve ou guarde essas mudanças antes de juntar.');
    if (fs.existsSync(worktree) && !(await clean(worktree)))
      throw new UserError('A pasta do agent tem mudanças sem commit. Peça para ele fazer o commit antes de juntar.');
    const into = await current(project);
    try {
      const out = await git(project, ['merge', '--no-ff', '--no-edit', branch]);
      return { into, output: out.trim().slice(-400) };
    } catch (e) {
      await git(project, ['merge', '--abort']).catch(() => {});
      throw new UserError('Não deu para juntar ' + branch + ' em ' + into + ' sem conflito. Nada mudou no projeto.');
    }
  }
  // Commits of the branch that the project's branch does not have yet.
  const ahead = (project, branch) =>
    git(project, ['rev-list', '--count', 'HEAD..' + branch])
      .then((o) => Number(o.trim()) || 0)
      .catch(() => 0);
  return { isRepo, ensureWorktree, removeWorktree, merge, ahead, current };
}

module.exports = { createTeamGit };
