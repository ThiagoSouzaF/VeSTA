// No telemetry, anywhere VeSTA has a say. VeSTA itself collects nothing; this module turns off what the programs it
// starts and the Chromium inside Electron would send on their own.
//   - childEnv(): the environment of every program VeSTA starts (AI CLIs, AI Memory, terminals). Each opt-out below
//     was checked against the installed program (strings in the binary or its documentation), none is guessed.
//   - CODEX_PRIVATE_ARGS: Codex reads analytics from its config, so it goes as `-c` overrides on its command line.
//   - hardenChromium() / hardenSession(): background requests of Chromium (spell-check dictionaries, component
//     updates, translation, autofill, hints) and permission prompts the app never needs.
//   - sweepTemp(): credential copies a crashed run left in the temp folder.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');

const PRIVATE_ENV = Object.freeze({
  DO_NOT_TRACK: '1',
  // Claude Code: usage telemetry, error reports (Sentry), /bug feedback upload, other non-essential calls. The last
  // one also skips the CLI's self-update check while VeSTA runs it; `claude update` still works.
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  DISABLE_BUG_COMMAND: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_ENABLE_TELEMETRY: '0',
  // OpenCode: no self-update and no public share links of sessions.
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_SHARE: '1',
  // Any OpenTelemetry SDK a tool may embed.
  OTEL_SDK_DISABLED: 'true',
});
const CODEX_PRIVATE_ARGS = Object.freeze(['-c', 'analytics.enabled=false']);

// `extra` wins over the opt-outs only for keys VeSTA sets on purpose (tokens, config content); the person's own
// environment never turns telemetry back on.
const childEnv = (extra = {}, base = process.env) => ({ ...base, ...PRIVATE_ENV, ...extra });

const CHROMIUM_OFF = [
  'AutofillServerCommunication',
  'CertificateTransparencyComponentUpdater',
  'MediaRouter',
  'OptimizationHints',
  'SpareRendererForSitePerProcess',
  'Translate',
];
// Before app ready. `existing` keeps features other modules disable (background-mode.cjs).
function hardenChromium(app) {
  for (const s of [
    'disable-background-networking',
    'disable-component-update',
    'disable-sync',
    'no-pings',
    'disable-breakpad',
  ])
    app.commandLine.appendSwitch(s);
  const existing = app.commandLine.getSwitchValue('disable-features');
  app.commandLine.appendSwitch('disable-features', [existing, ...CHROMIUM_OFF].filter(Boolean).join(','));
}
// Clipboard writes (copy buttons) are the only permission the pages use; everything else is refused silently.
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);
function hardenSession(session) {
  session.setSpellCheckerEnabled?.(false);
  session.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED_PERMISSIONS.has(permission)));
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

// Copies VeSTA made in the temp folder and removes on exit (the Drael credentials of a run, a downloaded installer).
// A crash leaves them behind: at the next start, the ones older than an hour are removed (only these prefixes).
const TEMP_PREFIXES = ['vesta-drael-', 'vesta-update-'];
function sweepTemp({ dir = os.tmpdir(), now = Date.now(), maxAgeMs = 3600e3 } = {}) {
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!TEMP_PREFIXES.some((p) => name.startsWith(p))) continue;
    const full = path.join(dir, name);
    try {
      if (now - fs.statSync(full).mtimeMs < maxAgeMs) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed++;
    } catch {}
  }
  return removed;
}

module.exports = {
  PRIVATE_ENV,
  CODEX_PRIVATE_ARGS,
  childEnv,
  hardenChromium,
  hardenSession,
  CHROMIUM_OFF,
  sweepTemp,
  TEMP_PREFIXES,
};
