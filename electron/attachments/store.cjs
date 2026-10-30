// Disk side of the chat attachments: copy into <userData>/attachments, thumbnails, move on send, cleanup.
//   attachments/_staging/<id>-<name>   chosen but not sent yet (composer chips, phone uploads)
//   attachments/<chatId>/<id>-<name>   sent with a message (+ <id>.thumb.png for png/jpeg)
const fs = require('node:fs'),
  path = require('node:path');
const { randomBytes } = require('node:crypto');
const { UserError } = require('../app/errors.cjs');
const A = require('./rules.cjs');

const THUMB_WIDTH = 320;
const MAX_STAGED = 60;
const STAGE_TTL_MS = 24 * 3600 * 1000;
const HEAD = 8192;

function readHead(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(HEAD, size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}
const newId = () => randomBytes(6).toString('hex');

function createAttachmentStore({ root, nativeImage = null }) {
  const staging = path.join(root, A.STAGING);
  const find = (dir, id) => {
    if (!A.ID.test(String(id)) || !dir || !fs.existsSync(dir)) return null;
    const hit = fs.readdirSync(dir).find((f) => f.startsWith(id + '-'));
    return hit ? path.join(dir, hit) : null;
  };
  const nameOf = (file) => path.basename(file).slice(13);
  // Reads the real file (never trusting what was said about it) and builds the descriptor.
  function describe(file, id) {
    const st = fs.statSync(file);
    const info = A.classify(nameOf(file), readHead(file, st.size), st.size);
    return { id, name: nameOf(file), kind: info.kind, mime: info.mime, size: st.size, path: file };
  }
  function thumbnail(att) {
    if (!nativeImage || att.kind !== 'image' || !/^image\/(png|jpeg)$/.test(att.mime)) return att;
    try {
      const img = nativeImage.createFromPath(att.path);
      if (img.isEmpty()) return att;
      const { width, height } = img.getSize();
      const small = width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH, quality: 'good' }) : img;
      fs.writeFileSync(A.thumbPath(att.path), small.toPNG());
      return { ...att, thumb: true, width, height };
    } catch {
      return att;
    }
  }
  function ensureStaging() {
    fs.mkdirSync(staging, { recursive: true });
    if (fs.readdirSync(staging).length > MAX_STAGED * 2)
      throw new UserError('Há anexos demais aguardando envio. Envie ou remova alguns.');
  }
  // After writing the copy: the destination is what gets validated, so a file that changed mid-copy cannot slip through.
  function finish(file, id) {
    try {
      return thumbnail(describe(file, id));
    } catch (e) {
      fs.rmSync(file, { force: true });
      throw e;
    }
  }
  return {
    root,
    staging,
    // Copies a file chosen on this machine (dialog, drop).
    stagePath(src) {
      let st;
      try {
        st = fs.statSync(src);
      } catch {
        throw new UserError('Não foi possível ler o arquivo escolhido');
      }
      if (!st.isFile()) throw new UserError('Escolha um arquivo (não uma pasta)');
      if (st.size > A.MAX_DOCUMENT)
        throw new UserError('"' + A.sanitizeName(path.basename(src)) + '" passa do limite de tamanho');
      A.classify(path.basename(src), readHead(src, st.size), st.size);
      ensureStaging();
      const id = newId(),
        dest = path.join(staging, A.fileName(id, path.basename(src)));
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
      return finish(dest, id);
    },
    // Stores bytes received from the renderer (paste, drop without a path) or from the phone.
    stageBuffer(name, buf) {
      if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
      if (buf.length > A.MAX_DOCUMENT) throw new UserError('O arquivo passa do limite de tamanho');
      A.classify(name, buf.subarray(0, HEAD), buf.length);
      ensureStaging();
      const id = newId(),
        dest = path.join(staging, A.fileName(id, name));
      fs.writeFileSync(dest, buf, { flag: 'wx' });
      return finish(dest, id);
    },
    stagedPath: (id) => find(staging, id),
    discard(id) {
      const file = find(staging, id);
      if (!file) return false;
      fs.rmSync(file, { force: true });
      fs.rmSync(A.thumbPath(file), { force: true });
      return true;
    },
    // Moves the staged files into the chat's folder and returns the descriptors stored in the message.
    commit(chatId, ids) {
      A.validateScope(chatId);
      if (chatId === A.STAGING) throw new UserError('Conversa inválida');
      ids = [...new Set(ids || [])];
      if (ids.length > A.MAX_COUNT) throw new UserError('No máximo ' + A.MAX_COUNT + ' anexos por mensagem');
      const found = ids.map((id) => {
        const file = find(staging, id);
        if (!file) throw new UserError('Um anexo não está mais disponível. Anexe o arquivo de novo.');
        return describe(file, id); // validated again, from the bytes on disk
      });
      const dir = A.scopeDir(root, chatId);
      fs.mkdirSync(dir, { recursive: true });
      return found.map((a) => {
        const dest = path.join(dir, path.basename(a.path)),
          thumb = A.thumbPath(a.path);
        fs.renameSync(a.path, dest);
        const out = { ...a, path: dest };
        if (fs.existsSync(thumb)) {
          fs.renameSync(thumb, A.thumbPath(dest));
          out.thumb = true;
        }
        return out;
      });
    },
    // Absolute path of a sent attachment (null if it is not one of this chat's files).
    fileOf(chatId, att) {
      const dir = A.scopeDir(root, chatId);
      const file = dir && att?.path ? path.resolve(att.path) : null;
      return file && path.dirname(file) === dir && fs.existsSync(file) ? file : null;
    },
    dirOf: (chatId) => A.scopeDir(root, chatId),
    // Deleting a chat deletes its attachments.
    removeChat(chatId) {
      if (!A.SCOPE.test(String(chatId)) || chatId === A.STAGING) return false;
      const dir = A.scopeDir(root, chatId);
      if (!dir || !fs.existsSync(dir)) return false;
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    },
    // Staged files nobody sent within a day (closed app, abandoned draft) go away.
    sweep(now = Date.now()) {
      let removed = 0;
      if (!fs.existsSync(staging)) return 0;
      for (const f of fs.readdirSync(staging)) {
        const file = path.join(staging, f);
        try {
          if (now - fs.statSync(file).mtimeMs > STAGE_TTL_MS) fs.rmSync(file, { force: true }), removed++;
        } catch {}
      }
      return removed;
    },
    // Folders of chats that no longer exist (a chat removed some other way).
    prune(chatIds) {
      if (!fs.existsSync(root)) return 0;
      const keep = new Set([...chatIds, A.STAGING]);
      let removed = 0;
      for (const d of fs.readdirSync(root)) {
        if (!keep.has(d) && A.SCOPE.test(d)) fs.rmSync(path.join(root, d), { recursive: true, force: true }), removed++;
      }
      return removed;
    },
    // Protocol handler body: absolute file for a vesta-attachment:// URL, or null.
    resolve: (url) => A.resolveUrl(root, url),
  };
}
module.exports = { createAttachmentStore };
