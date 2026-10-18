import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { api } from '../lib/api';
export function Markdown({ text }) {
  return (
    <div
      className="markdown"
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(marked.parse(text || '', { breaks: true }), {
          FORBID_TAGS: ['img', 'iframe'],
          FORBID_ATTR: ['style'],
        }),
      }}
      onClick={(e) => {
        const link = e.target.closest('a');
        if (link) {
          e.preventDefault();
          if (/^https?:\/\//i.test(link.href)) api?.call('openLink', { url: link.href }).catch(() => {});
        }
      }}
    />
  );
}
