import { PROVIDERS } from '../lib/constants';
export function ProviderIcon({ id, small = false }) {
  const p = PROVIDERS[id];
  return <span className={'provider-icon ' + p?.color + (small ? ' small' : '')}>{p?.letter || '◈'}</span>;
}
