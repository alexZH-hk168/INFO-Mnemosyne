// Notebook 只读预览：按单元格分块，只显示代码单元与 Markdown 单元；输出单元默认折叠（只显示“已折叠 N 个输出”），不运行。
// locator {path, cell, lines}：cell 从 0 开始，lines 是单元格内行号（契约 evidence-locator.md）。
import CodeBlock from './CodeBlock';
import MarkdownDoc from './MarkdownDoc';

interface NbCell {
  cell_type: string;
  source: string | string[];
  outputs?: unknown[];
}

export interface NbView {
  type: 'code' | 'markdown';
  source: string;
  outputs: number;
  index: number;
}

export interface ParsedNotebook {
  cells: NbView[];
  lang: string;
}

export function parseNotebook(raw: string): ParsedNotebook {
  const nb = JSON.parse(raw) as { cells?: NbCell[]; metadata?: { kernelspec?: { language?: string } } };
  const cells = (nb.cells ?? []).flatMap((c, index): NbView[] => {
    const source = Array.isArray(c.source) ? c.source.join('') : (c.source ?? '');
    if (c.cell_type === 'code') return [{ type: 'code', source, outputs: c.outputs?.length ?? 0, index }];
    if (c.cell_type === 'markdown') return [{ type: 'markdown', source, outputs: 0, index }];
    return [];
  });
  return { cells, lang: nb.metadata?.kernelspec?.language ?? 'python' };
}

export default function NotebookView({
  raw,
  cell,
  lines,
}: {
  raw: string;
  cell?: number | null;
  lines?: [number, number] | null;
}) {
  let nb: ParsedNotebook;
  try {
    nb = parseNotebook(raw);
  } catch {
    return (
      <div data-testid="right.code-preview.error" role="alert" className="p-6 text-center text-[13px] text-muted">
        Notebook 内容无法解析
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-3">
      {nb.cells.map((c) => {
        const active = cell === c.index;
        const prefix = `right.code-preview.cell:${c.index}`;
        return (
          <section
            key={c.index}
            data-testid={prefix}
            data-cell={c.index}
            data-active={active || undefined}
            aria-label={`单元格 ${c.index + 1}`}
            className={`overflow-hidden rounded-btn border ${active ? 'border-[var(--evi-hl-line)]' : 'border-line'}`}
          >
            <div className="flex items-center gap-2 border-b border-line-2 bg-panel px-2.5 py-1 text-[11px] text-muted">
              <span>{c.type === 'code' ? `[${c.index + 1}] 代码` : `[${c.index + 1}] Markdown`}</span>
            </div>
            {c.type === 'code' ? (
              <div className="overflow-x-auto bg-surface py-1">
                <CodeBlock
                  code={c.source}
                  filename="cell.py"
                  lang={nb.lang === 'python' ? 'python' : null}
                  highlight={active ? (lines ?? null) : null}
                  idPrefix={prefix}
                />
              </div>
            ) : (
              <div className="bg-surface px-3 py-1.5">
                <MarkdownDoc source={c.source} highlight={active ? (lines ?? null) : null} compact />
              </div>
            )}
            {c.outputs > 0 && (
              <div
                data-testid={`${prefix}.outputs`}
                className="border-t border-line-2 bg-panel px-2.5 py-1 text-[11px] text-faint"
              >
                已折叠 {c.outputs} 个输出
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
