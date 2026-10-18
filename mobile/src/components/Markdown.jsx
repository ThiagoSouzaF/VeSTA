import { memo, useMemo } from 'react';
import { markdownBlocks } from '../../../src/lib/markdown';

// Same sanitized pipeline as the desktop. Links open in a new tab, never inside the app.
const Block = memo(function Block({ html }) {
  return <div className="md-block" dangerouslySetInnerHTML={{ __html: html }} />;
});
export const Markdown = memo(function Markdown({ text }) {
  const blocks = useMemo(() => markdownBlocks(text), [text]);
  return (
    <div
      className="markdown"
      onClick={(e) => {
        const link = e.target.closest?.('a');
        if (!link) return;
        e.preventDefault();
        if (/^https?:\/\//i.test(link.href)) window.open(link.href, '_blank', 'noopener,noreferrer');
      }}
    >
      {blocks.map((html, i) => (
        <Block key={i} html={html} />
      ))}
    </div>
  );
});
