// Renderer-callable operations for chat attachments (merged into the IPC surface; a few are also on the phone allowlist).
const fs = require('node:fs');
const { UserError } = require('../app/errors.cjs');
const A = require('./rules.cjs');

const FILTERS = [
  { name: 'Todos os suportados', extensions: A.ACCEPT_EXT },
  { name: 'Imagens', extensions: Object.keys(A.IMAGE_EXT) },
  { name: 'Documentos', extensions: [...Object.keys(A.TEXT_EXT), ...Object.keys(A.OFFICE_EXT)] },
];
// Stages every item, collecting the ones refused instead of failing the whole batch.
function stageAll(items, stage) {
  const attachments = [],
    errors = [];
  for (const item of items) {
    try {
      attachments.push(stage(item));
    } catch (e) {
      errors.push(e instanceof UserError ? e.message : 'Não foi possível anexar o arquivo');
    }
  }
  return { attachments, errors };
}
// What the interface may keep: the file path stays in the main process.
const toRenderer = (a) => ({ ...A.publicAttachment(a), scope: A.STAGING });
function attachmentMethods(ctx) {
  const store = () => {
    if (!ctx.attachments) throw new UserError('Anexos indisponíveis');
    return ctx.attachments;
  };
  const sentFile = (chatId, id) => {
    const chat = ctx.store.chat(chatId);
    for (const m of chat.messages) {
      const att = m.attachments?.find((a) => a.id === id);
      if (att) {
        const file = store().fileOf(chatId, att);
        if (!file) throw new UserError('O arquivo anexado não existe mais');
        return { att, file };
      }
    }
    throw new UserError('Anexo não encontrado');
  };
  return {
    attachPick: async () => {
      const r = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Anexar arquivos',
        properties: ['openFile', 'multiSelections'],
        filters: FILTERS,
      });
      if (r.canceled) return { attachments: [], errors: [] };
      const out = stageAll(r.filePaths.slice(0, A.MAX_COUNT), (p) => toRenderer(store().stagePath(p)));
      return out;
    },
    attachPaths: ({ paths }) => {
      if (!Array.isArray(paths)) throw new UserError('Arquivos inválidos');
      return stageAll(paths.slice(0, A.MAX_COUNT).map(String), (p) => toRenderer(store().stagePath(p)));
    },
    attachData: ({ name, data }) => {
      const buf =
        data instanceof ArrayBuffer
          ? Buffer.from(data)
          : ArrayBuffer.isView(data)
            ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
            : null;
      if (!buf) throw new UserError('Arquivo inválido');
      return toRenderer(store().stageBuffer(String(name || 'imagem.png'), buf));
    },
    discardAttachment: ({ id }) => store().discard(String(id)),
    // Opens a SENT attachment with the default program (only files inside the chat's attachment folder).
    openAttachment: async ({ chatId, id }) => {
      const { file } = sentFile(chatId, id);
      const error = await ctx.shell.openPath(file);
      if (error) throw new UserError('Não foi possível abrir o arquivo');
      return true;
    },
    // For the phone: the image as data (thumbnail, or a reduced copy for the viewer). Documents have no preview.
    attachmentData: ({ chatId, id, full }) => {
      const { att, file } = sentFile(chatId, id);
      if (att.kind !== 'image') throw new UserError('Este anexo não tem pré-visualização');
      const thumb = A.thumbPath(file);
      if (!full && att.thumb && fs.existsSync(thumb))
        return { mime: 'image/png', data: fs.readFileSync(thumb).toString('base64') };
      let buf = fs.readFileSync(file),
        mime = att.mime;
      const img = ctx.nativeImage && /^image\/(png|jpeg)$/.test(mime) ? ctx.nativeImage.createFromBuffer(buf) : null;
      if (img && !img.isEmpty() && (img.getSize().width > 1600 || buf.length > 1.5 * 1048576)) {
        const w = Math.min(1600, img.getSize().width);
        buf = mime === 'image/png' ? img.resize({ width: w }).toPNG() : img.resize({ width: w }).toJPEG(82);
      }
      if (buf.length > 6 * 1048576) throw new UserError('Imagem grande demais para o celular. Abra no desktop.');
      return { mime, data: buf.toString('base64') };
    },
  };
}
module.exports = { attachmentMethods, stageAll, FILTERS };
