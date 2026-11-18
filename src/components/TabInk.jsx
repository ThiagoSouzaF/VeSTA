import { useTabInk } from '../hooks/useTabInk';

// The sliding indicator of a tab row (put it last inside the row, which gets .tab-ink-host). `active` selects the
// chosen option; `box` draws a frame around it instead of an underline.
export function TabInk({ active, value, box = false }) {
  const ink = useTabInk(active, value);
  return <span ref={ink} className={'tab-ink' + (box ? ' box' : '')} aria-hidden="true" />;
}
