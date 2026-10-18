// Updates come from the GitHub Releases of a private repo, read with the `gh` login of this machine: no token is stored by the app.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { run } = require('./providers.cjs');
const REPO = process.env.VESTA_UPDATE_REPO || 'ThiagoSouzaF/VeSTA';
const SETUP = /^VeSTA-Setup-.+\.exe$/;
function locateGh() {
  const names = ['gh.exe'];
  const candidates = (process.env.PATH || '')
    .split(path.delimiter)
    .flatMap((dir) => names.map((n) => path.join(dir, n)));
  candidates.push(
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe')
  );
  return (
    candidates.find((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    }) || null
  );
}
const parse = (v) =>
  String(v || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((n) => parseInt(n, 10) || 0);
function newer(candidate, current) {
  const a = parse(candidate),
    b = parse(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
// Only an NSIS install can update itself in place; dev runs and the portable build are left alone.
function installKind(app) {
  if (!app.isPackaged) return 'dev';
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  // The NSIS uninstaller sits next to the exe and is named after the product.
  try {
    return fs.readdirSync(path.dirname(process.execPath)).some((n) => /^Uninstall .+\.exe$/i.test(n))
      ? 'installed'
      : 'unknown';
  } catch {
    return 'unknown';
  }
}
// The `path:`/`sha512:` pair electron-builder writes into latest.yml for the installer.
function readLatestYml(text) {
  const pick = (key) => (new RegExp('^' + key + ':\\s*[\'"]?([^\'"\\r\\n]+)', 'm').exec(text) || [])[1]?.trim();
  return { version: pick('version'), path: pick('path'), sha512: pick('sha512') };
}
async function check(currentVersion, gh = locateGh()) {
  if (!gh) return { available: false, reason: 'GitHub CLI (gh) não encontrado' };
  let release;
  try {
    release = JSON.parse(await run(gh, ['api', 'repos/' + REPO + '/releases/latest'], { timeout: 20000 }));
  } catch (e) {
    return {
      available: false,
      reason: /404|Not Found/i.test(e.message)
        ? 'Nenhuma versão publicada'
        : 'Não foi possível consultar o GitHub: ' + e.message.split('\n')[0],
    };
  }
  const version = String(release.tag_name || '').replace(/^v/i, '');
  const assets = (release.assets || []).map((a) => a.name);
  const ready = assets.includes('latest.yml') && assets.some((n) => SETUP.test(n));
  return {
    available: ready && newer(version, currentVersion),
    version,
    current: currentVersion,
    tag: release.tag_name,
    notes: String(release.body || '').slice(0, 1500),
    url: release.html_url,
    reason: ready ? '' : 'A versão publicada não tem instalador',
  };
}
// Downloads the installer and checks it against the sha512 the build recorded in latest.yml.
async function download(info, gh = locateGh(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-update-'))) {
  // latest.yml names the installer asset, so the download does not depend on the product name of the build.
  await run(gh, ['release', 'download', info.tag, '-R', REPO, '-p', 'latest.yml', '-D', dir, '--clobber'], {
    timeout: 60000,
  });
  const name = readLatestYml(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8')).path;
  if (!name || path.basename(name) !== name || !SETUP.test(name))
    throw new Error('latest.yml inválido na versão publicada');
  await run(gh, ['release', 'download', info.tag, '-R', REPO, '-p', name, '-D', dir, '--clobber'], { timeout: 600000 });
  return verify(dir, info.version);
}
async function verify(dir, expectedVersion) {
  const meta = readLatestYml(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'));
  if (!meta.path || !meta.sha512 || path.basename(meta.path) !== meta.path)
    throw new Error('latest.yml inválido na versão publicada');
  if (expectedVersion && meta.version !== expectedVersion)
    throw new Error('latest.yml é da versão ' + meta.version + ', esperado ' + expectedVersion);
  const file = path.join(dir, meta.path);
  const digest = await new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (b) => h.update(b))
      .on('end', () => resolve(h.digest('base64')));
  });
  if (digest !== meta.sha512) throw new Error('O instalador baixado não confere com o latest.yml');
  return file;
}
// The installer outlives the app: silent install over the current one, then it reopens the app (--force-run).
// /D= pins the target to the folder this copy runs from, so an update never lands in a second install folder.
// NSIS wants /D= last and unquoted, so the command line is passed verbatim.
function installerArgs(installDir) {
  return ['/S', '--updated', '--force-run', ...(installDir ? ['/D=' + installDir] : [])];
}
function launchInstaller(file, installDir = path.dirname(process.execPath)) {
  spawn(file, installerArgs(installDir), {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  }).unref();
}
module.exports = {
  REPO,
  SETUP,
  locateGh,
  newer,
  installKind,
  readLatestYml,
  check,
  download,
  verify,
  installerArgs,
  launchInstaller,
};
