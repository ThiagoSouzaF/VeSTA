// Chat attachments in the interface: addresses of the files, labels and how files reach the main process.
import { api } from './api';

export const MAX_COUNT = 10;
export const MAX_FILE = 30 * 1024 * 1024;
export const fileOf = (a) => a.id + '-' + a.name;
// Files are served by the app's own protocol, restricted to the attachments folder (staging or a chat's folder).
export const attachmentUrl = (scope, a, thumb = false) =>
  'vesta-attachment://f/' +
  encodeURIComponent(scope) +
  '/' +
  encodeURIComponent(fileOf(a)) +
  (thumb && a.thumb ? '?t=1' : '');
export const fmtSize = (n) =>
  n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const ext = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
// Short mono label shown on the cards ("PNG", "PDF", "CSV"...).
export const typeLabel = (a) => ext(a.name).toUpperCase() || (a.kind === 'image' ? 'IMG' : 'DOC');
export function iconKind(a) {
  const e = ext(a.name);
  if (a.kind === 'image') return 'image';
  if (['xlsx', 'csv', 'tsv'].includes(e)) return 'sheet';
  if (e === 'pptx') return 'slides';
  if (['pdf', 'docx', 'txt', 'md', 'log'].includes(e)) return 'text';
  return 'code';
}
export const imagesOf = (list) => (list || []).filter((a) => a.kind === 'image');

// Sends dropped / pasted files to the main process: by path when the file has one (copied without crossing IPC),
// otherwise as bytes. Returns the attachments that were accepted; refusals are reported through notify.
export async function stageFiles(files, { call, notify }) {
  const paths = [],
    blobs = [];
  for (const f of files) {
    const p = api?.pathOf?.(f);
    p ? paths.push(p) : blobs.push(f);
  }
  const out = [],
    errors = [];
  if (paths.length) {
    try {
      const r = await call('attachPaths', { paths });
      out.push(...r.attachments);
      errors.push(...r.errors);
    } catch {}
  }
  for (const f of blobs) {
    if (f.size > MAX_FILE) {
      errors.push('"' + f.name + '" passa do limite de tamanho');
      continue;
    }
    try {
      out.push(await call('attachData', { name: f.name || 'imagem.png', data: await f.arrayBuffer() }));
    } catch {}
  }
  if (errors.length) notify(errors.join(' · '));
  return out;
}
export const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
