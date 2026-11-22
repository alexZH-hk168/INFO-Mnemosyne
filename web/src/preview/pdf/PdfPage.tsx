// 规格：2-证据胶囊-PDF预览（right.pdf-preview）的单页：canvas + pdf.js 文本层 + 高亮层 + 外挂“证据 N”标签。
// 只在接近可视区时渲染（IntersectionObserver），离开后保留占位尺寸。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { boxToCss, tagPosition, unionRects, type Box } from './geometry';
import { loadPdfJs } from './loadPdf';

export interface PageMarks {
  /** 证据高亮（契约坐标：原点左上、pt） */
  evidence?: Box[];
  /** “证据 N” */
  tag?: string | null;
  /** 页内查找命中 */
  find?: { boxes: Box[]; active: boolean }[];
}

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** 页面尺寸（pt） */
  size: { w: number; h: number };
  scale: number;
  marks?: PageMarks;
  /** 根滚动容器，用于判断是否接近可视区；单页模式传 null 直接渲染 */
  root: HTMLElement | null;
  eager?: boolean;
  /** 不渲染文本层（缩略图） */
  thumbnail?: boolean;
  testid?: string;
}

export default function PdfPage({ doc, pageNumber, size, scale, marks, root, eager, thumbnail, testid }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(!!eager);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (eager) return setNear(true);
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setNear(true);
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), {
      root,
      rootMargin: '800px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root, eager]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let textLayer: { cancel: () => void } | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      task = page.render({
        canvas,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      try {
        await task.promise;
      } catch {
        return; // 被取消
      }
      if (cancelled) return;
      if (!thumbnail && textRef.current) {
        const { TextLayer } = await loadPdfJs();
        const container = textRef.current;
        container.replaceChildren();
        const tl = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
        textLayer = tl;
        await tl.render().catch(() => undefined);
      }
      if (!cancelled) setRendered(true);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
      setRendered(false);
    };
  }, [near, doc, pageNumber, scale, thumbnail]);

  const w = size.w * scale;
  const h = size.h * scale;
  const ev = (marks?.evidence ?? []).map((b) => boxToCss(b, scale));
  const evUnion = unionRects(ev);
  const tagAt = evUnion ? tagPosition(evUnion) : null;

  return (
    <div
      ref={wrapRef}
      data-testid={testid}
      data-page={pageNumber}
      data-rendered={rendered || undefined}
      className="mn-pdf-page relative bg-surface"
      style={
        {
          width: w,
          height: h,
          '--scale-factor': scale,
          '--total-scale-factor': scale,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
        } as CSSProperties
      }
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute left-0 top-0" style={{ width: w, height: h }} />
      {!rendered && <div aria-hidden="true" className="mn-skel absolute inset-3 opacity-40" />}
      {ev.map((r, i) => (
        <div
          key={`ev${i}`}
          data-testid={i === 0 ? 'right.pdf-preview.highlight' : undefined}
          data-box={marks?.evidence?.[i]?.join(',')}
          aria-hidden="true"
          className="mn-pdf-hl pointer-events-none absolute"
          style={{ left: r.left - 2, top: r.top - 1, width: r.width + 4, height: r.height + 2 }}
        />
      ))}
      {(marks?.find ?? []).flatMap((hit, i) =>
        hit.boxes.map((b, j) => {
          const r = boxToCss(b, scale);
          return (
            <div
              key={`f${i}-${j}`}
              data-testid={hit.active && j === 0 ? 'right.pdf-preview.find-active' : undefined}
              aria-hidden="true"
              className={`pointer-events-none absolute rounded-[2px] ${hit.active ? 'mn-pdf-find-active' : 'mn-pdf-find'}`}
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            />
          );
        }),
      )}
      {!thumbnail && <div ref={textRef} className="mn-pdf-text" />}
      {tagAt && marks?.tag && (
        <span
          data-testid="right.pdf-preview.tag"
          className="pointer-events-none absolute z-[3] whitespace-nowrap rounded-chip bg-[var(--evi-tag)] px-1.5 py-[1px] text-[10.5px] font-semibold leading-[16px] text-surface"
          style={{ left: tagAt.left, top: tagAt.top }}
        >
          {marks.tag}
        </span>
      )}
    </div>
  );
}
