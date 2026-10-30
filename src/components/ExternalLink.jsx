import { api } from '../lib/api';

// Links never navigate the app window: the main process opens them in the default browser.
export function ExternalLink({ href, call = (method, args) => api?.call(method, args), children }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        call('openLink', { url: href });
      }}
    >
      {children}
    </a>
  );
}
