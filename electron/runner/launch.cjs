// `VeSTA.exe --vesta-agent <command> --home <folder>`: how the Task Scheduler starts an agent with VeSTA closed. No
// window, no single-instance lock (VeSTA may be open), and Chromium's own files go to a temp folder, never to the
// person's data. The runner used is the copy in the agents folder (the one its version.json describes), else the app's.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');

function launch(app, argv) {
  app.setPath('userData', path.join(os.tmpdir(), 'vesta-agent-electron'));
  const i = argv.indexOf('--home');
  const home = i >= 0 ? argv[i + 1] : null;
  const copy = home && path.join(home, 'runner', 'vesta-agent.cjs');
  const runner = require(copy && fs.existsSync(copy) ? copy : './vesta-agent.cjs');
  runner
    .main(argv)
    .catch(() => 1)
    .then((code) => app.exit(code));
}

const agentArgs = (argv) => {
  const i = argv.indexOf('--vesta-agent');
  return i >= 0 ? argv.slice(i + 1) : null;
};

module.exports = { launch, agentArgs };
