// Markdown 文件渲染为只读文档（react-markdown + remark-gfm + remark-math + rehype-katex）。
// locator {path, lines}：与 lines 重叠的块级元素整块高亮（#fbe8a6），行号取自 Markdown 语法树的位置。
import 'katex/dist/katex.min.css';
import type { ComponentProps, ElementType } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

type Pos = { start?: { line?: number }; end?: { line?: number } };

const BLOCKS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote', 'table'] as const;

function makeComponents(hl: [number, number] | null): Components {
  const out: Record<string, unknown> = {};
  for (const tag of BLOCKS) {
    const Tag = tag as ElementType;
    out[tag] = ({ node, ...rest }: ComponentProps<'p'> & { node?: { position?: Pos } }) => {
      const s = node?.position?.start?.line;
      const e = node?.position?.end?.line;
      const on = !!hl && s !== undefined && e !== undefined && s <= hl[1] && e >= hl[0];
      return (
        <Tag
          {...rest}
          data-line-start={s}
          data-line-end={e}
          data-hl={on || undefined}
          className={`${(rest as { className?: string }).className ?? ''} ${on ? 'mn-md-hl' : ''}`}
        />
      );
    };
  }
  return out as Components;
}

export default function MarkdownDoc({
  source,
  highlight,
  compact,
}: {
  source: string;
  highlight?: [number, number] | null;
  compact?: boolean;
}) {
  return (
    <div className={`mn-md-doc ${compact ? 'mn-md-compact' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={makeComponents(highlight ?? null)}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
