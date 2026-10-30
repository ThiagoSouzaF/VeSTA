// Child-process helpers shared by the main process: run a program to completion, end one (with its tree on Windows).
const { spawn, execFile } = require('node:child_process');
const { childEnv } = require('../app/privacy.cjs');
const { tail } = require('./text.cjs');

function run(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (!exe) return reject(new Error('Programa não encontrado'));
    const child = spawn(exe, args, { windowsHide: true, shell: false, ...options, env: options.env || childEnv() });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      kill(child);
      reject(new Error('O programa demorou para responder'));
    }, options.timeout || 20000);
    child.stdout.on('data', (b) => (stdout = tail(stdout, b, 1000000)));
    child.stderr.on('data', (b) => (stderr = tail(stderr, b, 10000)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || 'Erro ' + code));
    });
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(options.input || '');
    }
  });
}
function kill(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32')
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGTERM');
}
module.exports = { run, kill };
