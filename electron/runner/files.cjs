// The runner as it goes into an agents folder: its files (taken from the app, also from inside app.asar), their hash
// (a folder whose hash differs has an older runner) and the vesta-agent.cmd that runs it by hand.
const fs = require('node:fs'),
  path = require('node:path');
const { createHash } = require('node:crypto');

const ELECTRON_DIR = path.join(__dirname, '..');
// [name in the folder, path in the app]
const FILES = [
  ['vesta-agent.cjs', 'runner/vesta-agent.cjs'],
  ['scheduler.cjs', 'runner/scheduler.cjs'],
  ['agents.cjs', 'shared/agents.cjs'],
  ['privacy.cjs', 'app/privacy.cjs'],
];
const contents = () => FILES.map(([name, from]) => [name, fs.readFileSync(path.join(ELECTRON_DIR, from))]);
function runnerHash() {
  const h = createHash('sha256');
  for (const [name, body] of contents()) h.update(name).update(body);
  return h.digest('hex').slice(0, 12);
}
// What the folder has: { version, hash, at } or null.
function installedRunner(home) {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, 'runner', 'version.json'), 'utf8'));
  } catch {
    return null;
  }
}
// launcher: { exe, args } that starts the runner (VeSTA's executable with --vesta-agent, or node in tests).
// The .cmd runs the same files with VeSTA's executable acting as Node, so a terminal shows the JSON.
function writeRunner(home, { version, launcher, now = Date.now() }) {
  const dir = path.join(home, 'runner');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of contents()) fs.writeFileSync(path.join(dir, name), body);
  const cmd = [
    '@echo off',
    'rem Gerado pelo VeSTA: roda o executor de agents. Exemplo: vesta-agent list',
    'setlocal',
    'set ELECTRON_RUN_AS_NODE=1',
    '"' + launcher.exe + '" "%~dp0vesta-agent.cjs" %* --home "%~dp0.."',
  ].join('\r\n');
  fs.writeFileSync(path.join(dir, 'vesta-agent.cmd'), cmd + '\r\n');
  const info = { version, hash: runnerHash(), at: now };
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(info, null, 2));
  return info;
}

// The same files for a folder on another machine (places/remote.cjs): a Node program, read by `node -` there, that
// writes them, a `vesta-agent` shell script to use them by hand and version.json, then prints that version as JSON.
// Everything it needs travels inside it, so nothing has to be quoted for the remote shell.
function remoteWriter({ home, node, version, now = Date.now() }) {
  const files = contents().map(([name, body]) => [name, body.toString('base64')]);
  const info = { version, hash: runnerHash(), at: now };
  const script = [
    '#!/bin/sh',
    '# Gerado pelo VeSTA: roda o executor de agents. Exemplo: vesta-agent list',
    'exec ' + JSON.stringify(node) + ' "$(dirname "$0")/vesta-agent.cjs" "$@" --home ' + JSON.stringify(home),
    '',
  ].join('\n');
  return [
    "const fs = require('fs'), path = require('path');",
    'const dir = path.join(' + JSON.stringify(home) + ", 'runner');",
    'fs.mkdirSync(dir, { recursive: true });',
    'for (const [name, b64] of ' +
      JSON.stringify(files) +
      ") fs.writeFileSync(path.join(dir, name), Buffer.from(b64, 'base64'));",
    "fs.writeFileSync(path.join(dir, 'vesta-agent'), " + JSON.stringify(script) + ', { mode: 0o755 });',
    "fs.writeFileSync(path.join(dir, 'version.json'), " + JSON.stringify(JSON.stringify(info, null, 2)) + ');',
    'console.log(' + JSON.stringify(JSON.stringify(info)) + ');',
  ].join('\n');
}

module.exports = { FILES, runnerHash, installedRunner, writeRunner, remoteWriter };
