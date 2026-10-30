// A stand-in for Google's OAuth and Drive v3 endpoints, on 127.0.0.1, for the tests (unit and E2E): the sign-in with
// PKCE, token refresh and revoke, about, files (folder, list, get, media, trash) and resumable uploads.
// Only what gdrive.cjs uses; it checks the parts that matter (client, verifier, bearer token, parents).
const http = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

function createFakeGoogle({
  clientId = 'cli-123.apps.googleusercontent.com',
  clientSecret = 'GOCSPX-segredo-teste',
} = {}) {
  const files = new Map(); // id -> { id, name, mimeType, parents, appProperties, trashed, createdTime, content }
  const codes = new Map(); // code -> { challenge, redirect }
  const refresh = new Set(),
    tokens = new Set();
  const log = [];
  let seq = 0,
    deny = false,
    disabledApi = false;
  const id = () => 'f' + String(++seq).padStart(12, '0');
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const body = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
  const view = (f, fields) => {
    const all = {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      trashed: f.trashed,
      size: f.content ? String(f.content.length) : undefined,
      createdTime: f.createdTime,
      appProperties: f.appProperties,
    };
    if (!fields) return all;
    return Object.fromEntries(Object.entries(all).filter(([k]) => fields.includes(k)));
  };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;
    log.push(req.method + ' ' + p);
    // ---- OAuth ----
    if (p === '/auth') {
      const redirect = u.searchParams.get('redirect_uri');
      if (u.searchParams.get('client_id') !== clientId) return json(res, 400, { error: 'invalid_client' });
      if (deny) {
        res.writeHead(302, { Location: redirect + '/?error=access_denied&state=' + u.searchParams.get('state') });
        return res.end();
      }
      const code = 'code-' + randomBytes(6).toString('hex');
      codes.set(code, { challenge: u.searchParams.get('code_challenge'), redirect });
      res.writeHead(302, { Location: redirect + '/?code=' + code + '&state=' + u.searchParams.get('state') });
      return res.end();
    }
    if (p === '/token') {
      const f = new URLSearchParams((await body(req)).toString());
      if (f.get('client_id') !== clientId || f.get('client_secret') !== clientSecret)
        return json(res, 401, { error: 'invalid_client' });
      if (f.get('grant_type') === 'authorization_code') {
        const c = codes.get(f.get('code'));
        codes.delete(f.get('code'));
        const ok =
          c &&
          c.redirect === f.get('redirect_uri') &&
          createHash('sha256').update(f.get('code_verifier')).digest('base64url') === c.challenge;
        if (!ok) return json(res, 400, { error: 'invalid_grant' });
        const rt = 'rt-' + randomBytes(8).toString('hex'),
          at = 'at-' + randomBytes(8).toString('hex');
        refresh.add(rt);
        tokens.add(at);
        return json(res, 200, { access_token: at, refresh_token: rt, expires_in: 3600 });
      }
      if (f.get('grant_type') === 'refresh_token') {
        if (!refresh.has(f.get('refresh_token'))) return json(res, 400, { error: 'invalid_grant' });
        const at = 'at-' + randomBytes(8).toString('hex');
        tokens.add(at);
        return json(res, 200, { access_token: at, expires_in: 3600 });
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (p === '/revoke') {
      const f = new URLSearchParams((await body(req)).toString());
      refresh.delete(f.get('token'));
      return json(res, 200, {});
    }
    // ---- Drive ----
    // Resumable upload session: the URL itself is the credential, as in Google's API.
    const session = /^\/upload\/session\/(\w+)$/.exec(p);
    if (session && req.method === 'PUT') {
      const f = files.get(session[1]);
      f.content = await body(req);
      return json(res, 200, view(f, ['id', 'name', 'size']));
    }
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (!tokens.has(bearer)) return json(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
    if (disabledApi)
      return json(res, 403, {
        error: { message: 'Google Drive API has not been used', errors: [{ reason: 'accessNotConfigured' }] },
      });
    if (p === '/api/about')
      return json(res, 200, { user: { emailAddress: 'pessoa@exemplo.com', displayName: 'Pessoa' } });
    if (p === '/upload/files' && req.method === 'POST') {
      const meta = JSON.parse((await body(req)).toString());
      if (!meta.parents?.every((x) => files.has(x))) return json(res, 404, { error: { message: 'parent' } });
      const f = { id: id(), trashed: false, createdTime: new Date(Date.now() + seq).toISOString(), ...meta };
      files.set(f.id, f);
      res.writeHead(200, { Location: 'http://127.0.0.1:' + server.address().port + '/upload/session/' + f.id });
      return res.end();
    }
    if (p === '/api/files' && req.method === 'POST') {
      const meta = JSON.parse((await body(req)).toString());
      const f = { id: id(), trashed: false, createdTime: new Date().toISOString(), parents: [], ...meta };
      files.set(f.id, f);
      return json(res, 200, { id: f.id });
    }
    if (p === '/api/files' && req.method === 'GET') {
      const q = u.searchParams.get('q') || '';
      let list = [...files.values()].filter((f) => !f.trashed);
      const parent = /'([\w-]+)' in parents/.exec(q)?.[1];
      if (parent) list = list.filter((f) => f.parents?.includes(parent));
      if (/appProperties has \{ key='vesta' and value='backups' \}/.test(q))
        list = list.filter((f) => f.appProperties?.vesta === 'backups');
      const contains = /name contains '([^']+)'/.exec(q)?.[1];
      if (contains) list = list.filter((f) => f.name.includes(contains));
      return json(res, 200, { files: list.map((f) => view(f)) });
    }
    const one = /^\/api\/files\/([\w-]+)$/.exec(p);
    if (one) {
      const f = files.get(one[1]);
      if (!f) return json(res, 404, { error: { message: 'File not found' } });
      if (req.method === 'PATCH') {
        Object.assign(f, JSON.parse((await body(req)).toString()));
        return json(res, 200, view(f, ['id']));
      }
      if (u.searchParams.get('alt') === 'media') {
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        return res.end(f.content);
      }
      return json(res, 200, view(f, (u.searchParams.get('fields') || '').split(',').filter(Boolean)));
    }
    json(res, 404, { error: { message: 'not found: ' + p } });
  });
  return {
    clientId,
    clientSecret,
    files,
    log,
    deny: (v = true) => (deny = v),
    disableApi: (v = true) => (disabledApi = v),
    revokeAll: () => refresh.clear(),
    expireAccess: () => tokens.clear(),
    async listen() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + server.address().port;
      return {
        auth: base + '/auth',
        token: base + '/token',
        revoke: base + '/revoke',
        api: base + '/api',
        upload: base + '/upload',
      };
    },
    close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(() => r()))),
  };
}
// The "browser": follows Google's redirect back to VeSTA's loopback listener, as a person clicking "Allow" would.
async function browse(url) {
  const r = await fetch(url, { redirect: 'manual' });
  const to = r.headers.get('location');
  if (to) await fetch(to);
}
module.exports = { createFakeGoogle, browse };
