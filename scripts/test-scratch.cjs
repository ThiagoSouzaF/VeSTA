// Temporary data dir of an E2E script. On exit it removes what the run left behind: the dir itself (kept when the run
// failed, to inspect it) and the sessions Claude Code saved for it in ~/.claude/projects (one folder per working dir,
// named after the path). Set VESTA_KEEP_SCRATCH=1 to keep everything.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');

// Claude Code's folder name for a working dir: every character that is not a letter or digit becomes '-'.
const claudeProjectName = (dir) => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');
const dirs = [];
function cleanup() {
  if (process.env.VESTA_KEEP_SCRATCH === '1') return;
  const projects = path.join(os.homedir(), '.claude', 'projects');
  let names = [];
  try {
    names = fs.readdirSync(projects);
  } catch {}
  for (const dir of dirs) {
    // Only folders of this run's own scratch dir (and its subfolders), never anything else.
    const prefix = claudeProjectName(dir);
    for (const n of names)
      if (n === prefix || n.startsWith(prefix + '-'))
        try {
          fs.rmSync(path.join(projects, n), { recursive: true, force: true });
        } catch {}
    if (!process.exitCode)
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      } catch {}
  }
}
process.on('exit', cleanup);

module.exports = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-' + name + '-'));
  dirs.push(dir);
  return dir;
};
module.exports.claudeProjectName = claudeProjectName;
