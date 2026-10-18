import { memo, useMemo } from 'react';
import { markdownBlocks } from '../lib/markdown';
import { api } from '../lib/api';
// A block whose HTML did not change is not touched in the DOM: streaming only re-renders the last block.
const Block = memo(function Block({ html }) {
  return <div className="md-block" dangerouslySetInnerHTML={{ __html: html }} />;
});
export const Markdown = memo(function Markdown({ text }) {
  const blocks = useMemo(() => markdownBlocks(text), [text]);
  return (
    <div
      className="markdown"
      onClick={(e) => {
        const link = e.target.closest('a');
        if (link) {
          e.preventDefault();
          if (/^https?:\/\//i.test(link.href)) api?.call('openLink', { url: link.href }).catch(() => {});
        }
      }}
    >
      {blocks.map((html, i) => (
        <Block key={i} html={html} />
      ))}
    </div>
  );
});
