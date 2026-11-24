import { memo, useEffect, useMemo, useRef } from 'react';
import { markdownBlocks } from '../lib/markdown';
import { drawDiagrams } from '../lib/mermaid';
import { api } from '../lib/api';
// A block whose HTML did not change is not touched in the DOM: streaming only re-renders the last block.
// A ```mermaid block becomes its diagram after it is painted (lib/mermaid.js).
const Block = memo(function Block({ html }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && html.includes('md-mermaid')) drawDiagrams(ref.current);
  }, [html]);
  return <div ref={ref} className="md-block" dangerouslySetInnerHTML={{ __html: html }} />;
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
