// Google Drive for the backups, through the user's own OAuth client ("Desktop app" in their Google Cloud project).
// Scope drive.file: VeSTA sees only the files it created itself, never the rest of the Drive. Another computer that
// connects with the same client (same JSON) and the same Google account sees the same backups.
// Sign-in follows the installed-app flow: the system browser, a one-shot loopback redirect on 127.0.0.1 and PKCE.
// Credentials live in <userData>/google-drive.json, outside vesta.json (so never inside a backup); the client secret
// and the refresh token are sealed with the OS keychain (DPAPI on Windows) whenever it is available.
const fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const { randomBytes, createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { UserError } = require('../app/errors.cjs');
const { writeAtomic } = require('../util/sys.cjs');

const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
};
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'VeSTA backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SIGN_IN_MS = 5 * 60e3;
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The JSON Google offers to download for an OAuth client. Only "Desktop app" clients ({ installed: ... }) fit.
function parseClient(text) {
  let j;
  try {
    j = JSON.parse(String(text));
  } catch {
    throw new UserError('Este arquivo não é o JSON do cliente OAuth do Google');
  }
  if (j.web) throw new UserError('Este cliente é do tipo "Aplicativo da Web": crie um do tipo "App para computador"');
  const c = j.installed;
  if (!c?.client_id || !c?.client_secret) throw new UserError('Este arquivo não é o JSON do cliente OAuth do Google');
  return checkClient({ clientId: c.client_id, clientSecret: c.client_secret });
}
function checkClient({ clientId, clientSecret }) {
  clientId = String(clientId || '').trim();
  clientSecret = String(clientSecret || '').trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new UserError('O ID do cliente termina em .apps.googleusercontent.com');
  if (!/^[\w-]{10,}$/.test(clientSecret)) throw new UserError('Chave secreta do cliente inválida');
  return { clientId, clientSecret };
}

// Turns Google's answers into messages a person can act on.
function explain(status, body) {
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || body?.error || '';
  const text = body?.error?.message || body?.error_description || '';
  if (reason === 'invalid_grant')
    return 'O acesso ao Google Drive expirou ou foi revogado. Conecte de novo em Preferências → Backup.';
  if (reason === 'invalid_client' || reason === 'unauthorized_client')
    return 'O Google recusou o cliente OAuth (ID ou chave secreta). Confira o JSON do cliente.';
  if (/accessNotConfigured|SERVICE_DISABLED/.test(reason + text))
    return 'A Google Drive API está desativada no seu projeto do Google Cloud. Ative-a e tente de novo.';
  if (reason === 'storageQuotaExceeded') return 'Seu Google Drive está cheio.';
  if (status === 401) return 'O Google Drive recusou o acesso. Conecte de novo em Preferências → Backup.';
  return 'Google Drive respondeu ' + status + (text ? ': ' + text : '');
}

// file: where credentials are kept. seal/unseal: OS keychain (identity in tests). openExternal: opens the browser.
function createDrive({
  file,
  seal = (s) => s,
  unseal = (s) => s,
  openExternal,
  urls = GOOGLE,
  fetch = globalThis.fetch,
  timeoutMs = 60000,
}) {
  let access = null, // { token, until }
    signingIn = null;
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  };
  const write = (data) => writeAtomic(file, JSON.stringify(data, null, 2));
  const update = (patch) => write({ ...read(), ...patch });
  const secret = (sealed) => {
    try {
      return sealed ? unseal(sealed) : '';
    } catch {
      return '';
    }
  };
  const client = () => {
    const d = read();
    return d.clientId ? { clientId: d.clientId, clientSecret: secret(d.clientSecret) } : null;
  };

  async function request(url, init = {}, { raw = false } = {}) {
    const r = await fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(timeoutMs) });
    if (raw && r.ok) return r;
    const text = await r.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    if (!r.ok) {
      const message = explain(r.status, body);
      if ((body?.error === 'invalid_grant' || r.status === 401) && url === urls.token)
        update({ refreshToken: '', error: message });
      throw new UserError(message);
    }
    return raw ? r : body;
  }
  const form = (fields) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

  async function token() {
    if (access && access.until > Date.now()) return access.token;
    const c = client(),
      refresh = secret(read().refreshToken);
    if (!c || !refresh) throw new UserError('Conecte o Google Drive em Preferências → Backup');
    const t = await request(
      urls.token,
      form({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: refresh,
        grant_type: 'refresh_token',
      })
    );
    access = { token: t.access_token, until: Date.now() + Math.max(60, (t.expires_in || 3600) - 60) * 1000 };
    return access.token;
  }
  // An access token can die before its time (password change, revoked session): one retry with a fresh one.
  const api = async (url, init = {}, opts) => {
    const once = async () =>
      request(url, { ...init, headers: { ...init.headers, Authorization: 'Bearer ' + (await token()) } }, opts);
    try {
      return await once();
    } catch (e) {
      if (!/recusou o acesso/.test(e.message) || !access) throw e;
      access = null;
      return once();
    }
  };
  const q = (params) => '?' + new URLSearchParams(params).toString();

  // The folder that holds the backups: found by its mark (appProperties), created once.
  async function folder() {
    const saved = read().folderId;
    if (saved)
      try {
        const f = await api(urls.api + '/files/' + saved + q({ fields: 'id,trashed' }));
        if (!f.trashed) return f.id;
      } catch (e) {
        // Only a folder that is gone is looked up again; access problems surface as they are.
        if (!/respondeu 404/.test(e.message)) throw e;
      }
    const found = await api(
      urls.api +
        '/files' +
        q({
          q:
            "mimeType='" +
            FOLDER_MIME +
            "' and appProperties has { key='vesta' and value='backups' } and trashed=false",
          fields: 'files(id)',
          spaces: 'drive',
        })
    );
    let id = found.files?.[0]?.id;
    if (!id)
      id = (
        await api(urls.api + '/files' + q({ fields: 'id' }), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_MIME, appProperties: { vesta: 'backups' } }),
        })
      ).id;
    update({ folderId: id });
    return id;
  }

  // Browser sign-in: resolves once Google redirects back to the loopback listener with a code (or an error).
  function signIn(c) {
    const verifier = b64url(randomBytes(48)),
      state = b64url(randomBytes(16));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    return new Promise((resolve, reject) => {
      let timer;
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') return res.writeHead(404).end();
        // Only Google's redirect, carrying this sign-in's state, ends it: anything else (another program poking the port,
        // a stale tab) is ignored and the sign-in keeps waiting.
        if (u.searchParams.get('state') !== state) return res.writeHead(400).end();
        const code = u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<!doctype html><meta charset="utf-8"><title>VeSTA</title><body style="font:16px sans-serif;background:#111;color:#eee;padding:40px">' +
            (code
              ? 'Google Drive conectado ao VeSTA. Pode fechar esta aba.'
              : 'Não foi possível conectar. Volte ao VeSTA.') +
            '</body>'
        );
        if (code) finish(null, { code, redirect });
        else
          finish(
            new UserError(
              u.searchParams.get('error') === 'access_denied'
                ? 'Você não autorizou o acesso ao Google Drive'
                : 'O Google não completou o login'
            )
          );
      });
      let redirect = '';
      const finish = (err, value) => {
        clearTimeout(timer);
        server.close();
        server.closeAllConnections?.();
        err ? reject(err) : resolve(value);
      };
      server.on('error', (e) => finish(e));
      server.listen(0, '127.0.0.1', async () => {
        redirect = 'http://127.0.0.1:' + server.address().port;
        timer = setTimeout(() => finish(new UserError('O login no Google não foi concluído a tempo')), SIGN_IN_MS);
        const url =
          urls.auth +
          q({
            client_id: c.clientId,
            redirect_uri: redirect,
            response_type: 'code',
            scope: SCOPE,
            access_type: 'offline',
            prompt: 'consent',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
          });
        try {
          await openExternal(url);
        } catch (e) {
          finish(e);
        }
      });
    }).then(async ({ code, redirect }) => {
      const t = await request(
        urls.token,
        form({
          client_id: c.clientId,
          client_secret: c.clientSecret,
          code,
          code_verifier: verifier,
          redirect_uri: redirect,
          grant_type: 'authorization_code',
        })
      );
      if (!t.refresh_token)
        throw new UserError(
          'O Google não devolveu a permissão permanente. Remova o VeSTA em myaccount.google.com/permissions e conecte de novo.'
        );
      return t;
    });
  }

  return {
    status() {
      const d = read();
      return {
        configured: !!d.clientId,
        connected: !!(d.clientId && d.refreshToken),
        email: d.email || '',
        name: d.name || '',
        folder: FOLDER,
        connectedAt: d.connectedAt || 0,
        error: d.error || '',
        signingIn: !!signingIn,
      };
    },
    // Saves the OAuth client ({clientId, clientSecret} or the downloaded JSON text). Changing it signs out.
    setClient(input) {
      const c = typeof input === 'string' ? parseClient(input) : checkClient(input || {});
      const d = read();
      const same = d.clientId === c.clientId;
      write({ ...(same ? d : {}), clientId: c.clientId, clientSecret: seal(c.clientSecret), error: '' });
      if (!same) access = null;
      return this.status();
    },
    async connect() {
      const c = client();
      if (!c?.clientSecret) throw new UserError('Primeiro informe o cliente OAuth do Google');
      if (signingIn) return signingIn;
      signingIn = (async () => {
        const t = await signIn(c);
        access = { token: t.access_token, until: Date.now() + Math.max(60, (t.expires_in || 3600) - 60) * 1000 };
        update({ refreshToken: seal(t.refresh_token), connectedAt: Date.now(), error: '', folderId: '' });
        const about = await api(urls.api + '/about' + q({ fields: 'user(emailAddress,displayName)' }));
        update({ email: about.user?.emailAddress || '', name: about.user?.displayName || '' });
        await folder();
        return this.status();
      })().finally(() => (signingIn = null));
      return signingIn;
    },
    async disconnect() {
      const refresh = secret(read().refreshToken);
      if (refresh) await request(urls.revoke, form({ token: refresh })).catch(() => {});
      access = null;
      update({ refreshToken: '', email: '', name: '', folderId: '', connectedAt: 0, error: '' });
      return this.status();
    },
    // Uploads a local backup (resumable session: one PUT with the whole file). Returns { id, name, size }.
    async upload(localFile, { computer = '' } = {}) {
      const parent = await folder();
      const size = fs.statSync(localFile).size;
      const name = path.basename(localFile);
      // A password-protected backup (.vesta) is opaque bytes, not a zip.
      const mime = name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream';
      const start = await api(
        urls.upload + '/files' + q({ uploadType: 'resumable', fields: 'id,name,size' }),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mime,
            'X-Upload-Content-Length': String(size),
          },
          body: JSON.stringify({
            name,
            parents: [parent],
            mimeType: mime,
            appProperties: { vesta: 'backup', computer: String(computer).slice(0, 100) },
          }),
        },
        { raw: true }
      );
      const session = start.headers.get('location');
      if (!session) throw new UserError('O Google Drive não abriu o envio');
      const done = await request(
        session,
        {
          method: 'PUT',
          headers: { 'Content-Type': mime, 'Content-Length': String(size) },
          body: fs.readFileSync(localFile),
          signal: AbortSignal.timeout(Math.max(timeoutMs, 10 * 60e3)),
        },
        {}
      );
      return { id: done.id, name: done.name || name, size: Number(done.size) || size };
    },
    // Backups in the Drive folder, newest first: [{ id, name, size, createdAt, computer }].
    async list() {
      const parent = await folder();
      const r = await api(
        urls.api +
          '/files' +
          q({
            q: "'" + parent + "' in parents and trashed=false and name contains 'VeSTA-backup-'",
            fields: 'files(id,name,size,createdTime,appProperties)',
            orderBy: 'createdTime desc',
            pageSize: '200',
          })
      );
      return (r.files || [])
        .map((f) => ({
          id: f.id,
          name: f.name,
          size: Number(f.size) || 0,
          createdAt: Date.parse(f.createdTime) || 0,
          computer: f.appProperties?.computer || '',
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    // Moves the oldest backups beyond `keep` to the Drive trash (Google empties it after 30 days).
    async prune(keep) {
      const old = (await this.list()).slice(keep);
      for (const f of old)
        await api(urls.api + '/files/' + encodeURIComponent(f.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trashed: true }),
        });
      return old.map((f) => f.name);
    },
    async download(id, dest) {
      if (!/^[\w-]{10,200}$/.test(String(id))) throw new UserError('Backup inválido');
      const r = await api(
        urls.api + '/files/' + id + q({ alt: 'media' }),
        { signal: AbortSignal.timeout(10 * 60e3) },
        { raw: true }
      );
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
      return dest;
    },
  };
}

module.exports = { createDrive, parseClient, checkClient, explain, GOOGLE, SCOPE, FOLDER };
