// 规格：2-文件行-代码预览（right.code-preview）
// Shiki 高亮的只读代码，带行号；Notebook 按单元格分块（只显示代码单元与 Markdown 单元，输出折叠）；Markdown 文件渲染为文档。
// 入口：证据胶囊 / 文件行，tab kind=code（含 ipynb）/md，locator.lines / locator.cell。接口：GET /api/documents/{did}/raw（文本）。
// 有 locator 时滚到行并整行高亮（#fbe8a6）；> 5000 行虚拟滚动。不提供编辑、运行。
import { useEffect, useState } from 'react';
import { useDocument } from '../api/queries';
import type { Tab } from '../store/layout';
import CodeBlock, { ROW_H, VIRTUAL_THRESHOLD, splitLines } from './code/CodeBlock';
import MarkdownDoc from './code/MarkdownDoc';
import NotebookView from './code/NotebookView';
import { useRaw } from './raw';
import { useTabEvidence } from './useEvidenceContext';
import { useEvidence } from '../store/evidence';

type Kind = 'code' | 'ipynb' | 'md';

function pairOf(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number') ? [v[0], v[1]] : null;
}

export default function CodeViewer({ tab }: { tab: Tab }) {
  const doc = useDocument(tab.ref_id);
  const raw = useRaw(tab.ref_id, 'text');
  const ev = useTabEvidence(tab);
  const nonce = useEvidence((s) => s.messageEvidence);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  const kind: Kind =
    tab.kind === 'md' ? 'md' : doc.data?.kind === 'ipynb' || /\.ipynb$/i.test(tab.title) ? 'ipynb' : 'code';
  const loc = (ev?.locator ?? {}) as { lines?: unknown; cell?: unknown };
  const lines = pairOf(loc.lines);
  const cell = typeof loc.cell === 'number' ? loc.cell : null;
  const text = raw.status === 'ready' ? raw.data : '';

  // 滚到证据所在行（或单元格），放在可视区上部 1/3 处
  useEffect(() => {
    if (!scroller || raw.status !== 'ready' || !lines) return;
    const place = (top: number) => scroller.scrollTo({ top: Math.max(0, top - scroller.clientHeight * 0.33) });
    if (kind === 'code' && splitLines(text).length > VIRTUAL_THRESHOLD) {
      place((lines[0] - 1) * ROW_H);
      return;
    }
    const raf = requestAnimationFrame(() => {
      let el: HTMLElement | null = null;
      if (kind === 'code') el = scroller.querySelector(`[data-line="${lines[0]}"]`);
      else if (kind === 'ipynb' && cell !== null) {
        const c = scroller.querySelector<HTMLElement>(`[data-cell="${cell}"]`);
        el = c?.querySelector<HTMLElement>(`[data-line="${lines[0]}"], [data-hl]`) ?? c ?? null;
      } else if (kind === 'md') el = scroller.querySelector('[data-hl]');
      if (!el) return;
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      place(top);
    });
    return () => cancelAnimationFrame(raf);
    // lines 是新数组：按值比较
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller, raw.status, kind, lines?.[0], lines?.[1], cell, nonce, text]);

  return (
    <div
      data-testid="right.code-preview"
      data-kind={kind}
      data-state={raw.status}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="flex h-9 flex-none items-center gap-2 border-b border-line px-3 text-[12px] text-muted">
        <span className="min-w-0 truncate text-ink-2">{tab.title}</span>
      </div>
      <div
        ref={setScroller}
        tabIndex={0}
        aria-label={`${tab.title} 预览`}
        className="mn-focus min-h-0 flex-1 overflow-auto"
      >
        {raw.status === 'loading' && (
          <div data-testid="right.code-preview.loading" aria-busy="true" className="flex flex-col gap-2 p-4">
            {[70, 90, 55, 80, 40].map((w, i) => (
              <div key={i} className="mn-skel h-3.5" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {raw.status === 'error' && (
          <div data-testid="right.code-preview.error" role="alert" className="p-6 text-center text-[13px] text-muted">
            预览加载失败：{raw.error.message}
          </div>
        )}
        {raw.status === 'ready' && kind === 'code' && (
          <div className="py-2">
            <CodeBlock
              code={text}
              filename={tab.title}
              highlight={lines}
              idPrefix="right.code-preview"
              scroller={scroller}
            />
          </div>
        )}
        {raw.status === 'ready' && kind === 'ipynb' && <NotebookView raw={text} cell={cell} lines={lines} />}
        {raw.status === 'ready' && kind === 'md' && (
          <div className="px-6 py-4">
            <MarkdownDoc source={text} highlight={lines} />
          </div>
        )}
      </div>
    </div>
  );
}
