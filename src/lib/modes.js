import { Pencil, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { MODE_DATA } from './modeData';
const ICONS = { ask: ShieldQuestion, edit: Pencil, read: ShieldCheck };
export const MODES = Object.fromEntries(Object.entries(MODE_DATA).map(([id, m]) => [id, { ...m, icon: ICONS[id] }]));
export const modeOf = (m) => (MODES[m] ? m : 'edit');
