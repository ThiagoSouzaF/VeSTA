// Chat modes as shown on the phone (same ids and wording as the desktop; no icons needed here).
import { MODE_DATA } from '../../../src/lib/modeData';
export const MODES = MODE_DATA;
export const modeLabel = (m) => (MODES[m] || MODES.edit).label;
