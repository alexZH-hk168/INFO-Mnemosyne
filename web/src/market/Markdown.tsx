// 规格：3-条目卡片-Skill详情页 的 SKILL.md 预览：只读 Markdown 渲染，代码块高亮。解析与高亮在 markdownParse.tsx。
import { Fragment } from 'react';
import { highlight, inline, parseBlocks, splitFrontMatter } from './markdownParse';

const H_CLASS: Record<number, string> = {
  1: 'mt-1.5 mb-1.5 text-[16px] font-semibold text-ink',
  2: 'mt-3 mb-1 text-[14px] font-semibold text-ink',
  3: 'mt-2.5 mb-1 text-[13.5px] font-semibold text-ink',
};

export default function Markdown({ source, testid }: { source: string; testid?: string }) {
  const { front, body } = splitFrontMatter(source);
  const blocks = parseBlocks(body);
  return (
    <div data-testid={testid} className="text-[13px] leading-[1.75] text-ink-2">
      {front && (
        <pre
          data-testid={testid ? `${testid}.frontmatter` : undefined}
          className="mb-3 whitespace-pre-wrap rounded-btn bg-[var(--code-bg)] px-3 py-2.5 font-mono text-[11.8px] leading-[1.6] text-ink-2"
        >
          {front.raw}
        </pre>
      )}
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading': {
            const Tag = `h${Math.min(6, b.level + 2)}` as 'h3';
            return (
              <Tag key={i} id={`md-${b.id}`} className={H_CLASS[b.level] ?? H_CLASS[3]}>
                {inline(b.text)}
              </Tag>
            );
          }
          case 'para':
            return (
              <p key={i} className="my-1.5">
                {inline(b.text)}
              </p>
            );
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul';
            return (
              <L key={i} className={`my-1.5 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
                {b.items.map((t, j) => (
                  <li key={j}>{inline(t)}</li>
                ))}
              </L>
            );
          }
          case 'quote':
            return (
              <blockquote key={i} className="my-2 border-l-2 border-line pl-3 text-muted">
                {inline(b.text)}
              </blockquote>
            );
          case 'code':
            return (
              <pre
                key={i}
                data-lang={b.lang || undefined}
                className="my-2 overflow-x-auto rounded-btn bg-[var(--code-bg)] px-3 py-2.5 font-mono text-[12px] leading-[1.6] text-[var(--code-ink)]"
              >
                <code>{highlight(b.text, b.lang)}</code>
              </pre>
            );
          case 'rule':
            return <hr key={i} className="my-3 border-line" />;
          default:
            return <Fragment key={i} />;
        }
      })}
    </div>
  );
}
