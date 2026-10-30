// The vesta-attachment:// scheme: chat images are shown through it and nothing else. It resolves only inside
// <userData>/attachments (attachments/store.cjs) and serves only images; documents open in their default program.
const fs = require('node:fs'),
  path = require('node:path');
const { pathToFileURL } = require('node:url');
const { IMAGE_EXT } = require('./rules.cjs');

const SCHEME = 'vesta-attachment';
// Before app ready.
const registerScheme = (protocol) =>
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
// After app ready. `resolve(url)` -> absolute file inside the attachments folder, or null.
function handleScheme(protocol, net, resolve) {
  protocol.handle(SCHEME, async (request) => {
    const file = resolve(request.url);
    const ext = file && path.extname(file);
    const mime = file && (ext === '.png' ? 'image/png' : IMAGE_EXT[ext.slice(1).toLowerCase()]);
    if (!mime || !fs.existsSync(file)) return new Response('', { status: 404 });
    const r = await net.fetch(pathToFileURL(file).href);
    return new Response(r.body, {
      headers: { 'content-type': mime, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600' },
    });
  });
}

module.exports = { SCHEME, registerScheme, handleScheme };
