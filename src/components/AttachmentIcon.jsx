import { FileCode, FileImage, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { iconKind } from '../lib/attachments';
const ICONS = { image: FileImage, sheet: FileSpreadsheet, slides: Presentation, text: FileText, code: FileCode };
export function AttachmentIcon({ a, size = 18 }) {
  const Icon = ICONS[iconKind(a)];
  return <Icon size={size} aria-hidden="true" />;
}
