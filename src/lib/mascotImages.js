// Mascot art (black and white manga). Small webp panels, bundled by Vite; shared by the desktop and the phone.
import idle from '../../assets/mascot/state-idle.webp';
import thinking from '../../assets/mascot/state-thinking.webp';
import working from '../../assets/mascot/state-working.webp';
import success from '../../assets/mascot/state-success.webp';
import error from '../../assets/mascot/state-error.webp';
import sleeping from '../../assets/mascot/state-sleeping.webp';
import full from '../../assets/mascot/full.webp';
import turnaround from '../../assets/mascot/turnaround.webp';

export const MASCOT = { idle, thinking, working, success, error, sleeping };
export const MASCOT_ART = { full, turnaround };
let preloaded = false;
// Decodes every panel once, so changing state never waits for the network or the decoder.
export function preloadMascot() {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  for (const src of Object.values(MASCOT)) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }
}
