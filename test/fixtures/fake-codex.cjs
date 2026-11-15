// Fake `codex app-server` for the driver tests. FAKE_CODEX = silent (reads stdin, never answers) | exit (quits at once).
process.stdin.resume();
if (process.env.FAKE_CODEX === 'exit') process.exit(3);
