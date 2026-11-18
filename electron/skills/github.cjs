// Skills from a GitHub link: one skill (a folder with SKILL.md, or the SKILL.md itself) or a repository/folder with
// many. Public repositories go through the GitHub API and raw.githubusercontent.com; when that fails (private
// repository, rate limit) the GitHub CLI already logged in on this computer (`gh api`) is tried. Nothing is sent
// besides the requests for the files themselves.
const path = require('node:path');
const { UserError } = require('../app/errors.cjs');
const F = require('./format.cjs');

// -> { owner, repo, ref (null = default branch), path } or null.
function parseGithubUrl(input) {
  let u;
  try {
    u = new URL(String(input || '').trim());
  } catch {
    return null;
  }
  const parts = u.pathname
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  if (u.hostname === 'raw.githubusercontent.com') {
    if (parts.length < 3) return null;
    const [owner, repo, ref, ...rest] = parts;
    return { owner, repo, ref, path: dirOf(rest.join('/')) };
  }
  if (!/^(www\.)?github\.com$/.test(u.hostname) || parts.length < 2) return null;
  const [owner, repoRaw, kind, ref, ...rest] = parts;
  const repo = repoRaw.replace(/\.git$/, '');
  if (!kind) return { owner, repo, ref: null, path: '' };
  if (kind !== 'tree' && kind !== 'blob') return null;
  if (!ref) return null;
  const p = rest.join('/');
  return { owner, repo, ref, path: kind === 'blob' ? dirOf(p) : p.replace(/\/+$/, '') };
}
// A link to a file points at the skill folder holding it.
const dirOf = (p) => (/\.md$/i.test(p) ? path.posix.dirname(p).replace(/^\.$/, '') : p.replace(/\/+$/, ''));

// net = { json(endpoint) -> object, raw(owner, repo, ref, path) -> string }: see githubNet below.
async function scanGithub(url, net) {
  const loc = parseGithubUrl(url);
  if (!loc) throw new UserError('Link do GitHub não reconhecido. Use o endereço de um repositório, pasta ou SKILL.md.');
  const repoInfo = await net.json('repos/' + loc.owner + '/' + loc.repo);
  const ref = loc.ref || repoInfo.default_branch || 'main';
  const tree = await net.json(
    'repos/' + loc.owner + '/' + loc.repo + '/git/trees/' + encodeURIComponent(ref) + '?recursive=1'
  );
  const blobs = (tree.tree || []).filter((t) => t.type === 'blob');
  const prefix = loc.path ? loc.path + '/' : '';
  const skillDirs = blobs
    .filter((b) => (b.path === prefix + 'SKILL.md' || b.path.startsWith(prefix)) && /(^|\/)SKILL\.md$/.test(b.path))
    .map((b) => path.posix.dirname(b.path).replace(/^\.$/, ''));
  if (!skillDirs.length) throw new UserError('Nenhuma SKILL.md encontrada nesse link.');
  const label =
    loc.owner +
    '/' +
    loc.repo +
    (loc.path
      ? ' · ' +
        loc.path
          .split('/')
          .filter((x) => x !== 'skills')
          .pop()
      : '');
  const license =
    repoInfo.license?.spdx_id && repoInfo.license.spdx_id !== 'NOASSERTION' ? repoInfo.license.spdx_id : '';
  // Files of a skill: everything under its folder that is not inside another skill folder below it.
  const filesOf = (dir) =>
    blobs.filter((b) => {
      const inDir = dir ? b.path.startsWith(dir + '/') : true;
      if (!inDir || b.path === (dir ? dir + '/' : '') + 'SKILL.md') return false;
      return !skillDirs.some((o) => o !== dir && o.startsWith(dir ? dir + '/' : '') && b.path.startsWith(o + '/'));
    });
  const candidates = await mapLimit(skillDirs.slice(0, 200), 8, async (dir) => {
    const skillPath = (dir ? dir + '/' : '') + 'SKILL.md';
    const text = await net.raw(loc.owner, loc.repo, ref, skillPath);
    const { data } = F.parseSkill(text);
    const files = filesOf(dir).map((b) => ({
      path: b.path.slice(dir ? dir.length + 1 : 0),
      repoPath: b.path,
      size: b.size,
    }));
    return {
      name: F.skillName(data, path.posix.basename(dir) || loc.repo),
      description: String(data.description || '').slice(0, 600),
      text,
      files: files.filter((f) => F.isTextFile(f.path)),
      skipped: files.filter((f) => !F.isTextFile(f.path)).map((f) => f.path),
      hasScripts: files.some((f) => F.isScript(f.path)),
      license,
      source: {
        kind: 'github',
        label,
        url: 'https://github.com/' + loc.owner + '/' + loc.repo + '/tree/' + ref + (dir ? '/' + dir : ''),
        path: dir,
        license,
      },
      // How to download the supporting files later (only for the skills the person picks).
      fetch: { owner: loc.owner, repo: loc.repo, ref },
    };
  });
  return { label, truncated: !!tree.truncated, candidates };
}

// Downloads the supporting files of a picked candidate (within the size limits) -> files [{ path, text }].
async function fetchFiles(candidate, net) {
  const out = [];
  let total = 0;
  for (const f of candidate.files) {
    if (out.length >= F.LIMITS.files || f.size > F.LIMITS.fileBytes || total + f.size > F.LIMITS.totalBytes) continue;
    total += f.size;
    const { owner, repo, ref } = candidate.fetch;
    out.push({ path: f.path, text: await net.raw(owner, repo, ref, f.repoPath) });
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

// The real network: fetch first, `gh api` as the fallback (private repositories, API rate limit).
function githubNet({ fetchImpl = globalThis.fetch, gh = null } = {}) {
  const headers = { 'user-agent': 'VeSTA', accept: 'application/vnd.github+json' };
  async function viaGh(endpoint) {
    if (!gh) return null;
    try {
      return JSON.parse(await gh(['api', endpoint]));
    } catch {
      return null;
    }
  }
  return {
    async json(endpoint) {
      let status = 0;
      try {
        const r = await fetchImpl('https://api.github.com/' + endpoint, { headers });
        status = r.status;
        if (r.ok) return await r.json();
      } catch {}
      const viaCli = await viaGh(endpoint);
      if (viaCli) return viaCli;
      if (status === 404) throw new UserError('Repositório não encontrado (ou privado sem login no GitHub CLI).');
      if (status === 403) throw new UserError('O GitHub limitou as consultas. Tente de novo em alguns minutos.');
      throw new UserError('Não foi possível falar com o GitHub.');
    },
    async raw(owner, repo, ref, p) {
      const enc = p.split('/').map(encodeURIComponent).join('/');
      try {
        const r = await fetchImpl('https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + ref + '/' + enc, {
          headers: { 'user-agent': 'VeSTA' },
        });
        if (r.ok) return await r.text();
      } catch {}
      const c = await viaGh('repos/' + owner + '/' + repo + '/contents/' + enc + '?ref=' + encodeURIComponent(ref));
      if (c?.content) return Buffer.from(c.content, 'base64').toString('utf8');
      throw new UserError('Não foi possível baixar ' + p + ' do GitHub.');
    },
  };
}

module.exports = { parseGithubUrl, scanGithub, fetchFiles, githubNet };
