// 规格：2-证据胶囊-PDF预览（right.pdf-preview）；单页模式供 2-证据胶囊-PPT预览（right.slide-preview）复用。
// pdf.js 渲染（canvas + 文本层 + 高亮层）。由证据打开时跳到 page 并按 bbox 高亮（#fbe8a6），“证据 N”标签外挂在高亮框右侧的页边距里；
// bbox 缺失或越界时退回高亮证据原文所在的文字块。只读：不提供批注、编辑。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ID } from '../../api/types';
import { useEvidence } from '../../store/evidence';
import PdfToolbar, { type FindState } from '../PdfToolbar';
import { downloadRaw, useRaw } from '../raw';
import {
  findInItems,
  isValidBbox,
  locateQuote,
  pdfRectToTopLeft,
  spanToPdfRect,
  type Box,
  type TextItemLike,
} from './geometry';
import { openPdf, type OpenedPdf } from './loadPdf';
import PdfPage, { type PageMarks } from './PdfPage';

export interface PdfTarget {
  page: number;
  bbox?: unknown;
  quote?: string;
  /** “证据 N” */
  tag?: string | null;
  /** 只跳页不高亮（PPT v1） */
  noHighlight?: boolean;
}

interface Props {
  docId: ID;
  title: string;
  mode: 'scroll' | 'single';
  testid: string;
  target: PdfTarget | null;
  /** 原文读不到时的文案（PPT：“预览生成失败”） */
  failedText?: string;
  /** 材料本身解析失败（PPT 转换失败） */
  failed?: boolean;
}

const PAD_Y = 16;
const PAD_X = 32;
const GAP = 12;
const THUMB_H = 72;

interface PageText {
  items: TextItemLike[];
  view: number[];
}

type Hit = { page: number; boxes: Box[] };

function pdfFileName(title: string) {
  return /\.pdf$/i.test(title) ? title : `${title.replace(/\.[^./]+$/, '')}.pdf`;
}

export default function PdfViewer({ docId, title, mode, testid, target, failedText, failed }: Props) {
  const raw = useRaw(docId, 'bytes');
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [hl, setHl] = useState<{ page: number; boxes: Box[]; tag?: string | null } | null>(null);
  const [find, setFind] = useState<FindState>({ open: false, query: '', total: 0, active: 0, searching: false });
  const [hits, setHits] = useState<Hit[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const textCache = useRef(new Map<number, Promise<PageText>>());
  // 同一证据再次被点（select 每次都换新数组）时也重新跳转
  const nonce = useEvidence((s) => s.messageEvidence);

  // ---- 打开文档
  useEffect(() => {
    if (raw.status !== 'ready') return;
    let cancelled = false;
    let opened: OpenedPdf | null = null;
    setLoadError(null);
    openPdf(raw.data)
      .then(async (o) => {
        opened = o;
        if (cancelled) return void o.destroy();
        const d = o.doc;
        const s: { w: number; h: number }[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const p = await d.getPage(i);
          const v = p.getViewport({ scale: 1 });
          s.push({ w: v.width, h: v.height });
        }
        if (cancelled) return;
        textCache.current = new Map();
        setSizes(s);
        setDoc(d);
      })
      .catch((e: unknown) => !cancelled && setLoadError((e as Error).message || 'PDF 解析失败'));
    return () => {
      cancelled = true;
      void opened?.destroy();
      setDoc(null);
    };
  }, [raw]);

  // ---- 预览区尺寸
  useEffect(() => {
    if (!scroller) return;
    const measure = () => setBox({ w: scroller.clientWidth, h: scroller.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);

  const maxW = sizes.reduce((m, s) => Math.max(m, s.w), 0) || 612;
  const cur = sizes[page - 1] ?? { w: maxW, h: maxW * 1.29 };
  const fit =
    mode === 'single'
      ? Math.min((box.w - 2 * PAD_X) / cur.w, (box.h - THUMB_H - 3 * PAD_Y) / cur.h)
      : (box.w - 2 * PAD_X) / maxW;
  const scale = Math.max(0.1, (Number.isFinite(fit) && fit > 0 ? fit : 0.75) * zoom);

  const tops = useMemo(() => {
    const t: number[] = [];
    let y = PAD_Y;
    for (const s of sizes) {
      t.push(y);
      y += s.h * scale + GAP;
    }
    return t;
  }, [sizes, scale]);

  const pageText = useCallback(
    (n: number): Promise<PageText> => {
      const cached = textCache.current.get(n);
      if (cached) return cached;
      const p = (async () => {
        if (!doc) return { items: [], view: [0, 0, 0, 0] };
        const pg = await doc.getPage(n);
        const tc = await pg.getTextContent();
        const items = tc.items.flatMap((it) => ('str' in it ? [it as unknown as TextItemLike] : []));
        return { items, view: pg.view };
      })();
      textCache.current.set(n, p);
      return p;
    },
    [doc],
  );

  // ---- 跳页
  const scrollToY = useCallback(
    (y: number) => {
      if (scroller) scroller.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    },
    [scroller],
  );
  const goPage = useCallback(
    (n: number) => {
      const p = Math.min(Math.max(1, n), sizes.length || 1);
      setPage(p);
      if (mode === 'scroll' && tops[p - 1] !== undefined) scrollToY(tops[p - 1] - PAD_Y / 2);
    },
    [mode, sizes.length, tops, scrollToY],
  );

  // ---- 证据定位：bbox 可用就用；否则在该页文本里找原文所在的文字块
  const targetKey = target ? `${target.page}|${JSON.stringify(target.bbox ?? null)}|${target.quote ?? ''}` : '';
  const ready = !!doc && sizes.length > 0 && box.w > 0;
  useEffect(() => {
    if (!ready || !target) {
      setHl(null);
      return;
    }
    let cancelled = false;
    const p = Math.min(Math.max(1, target.page), sizes.length);
    setPage(p);
    (async () => {
      let boxes: Box[] = [];
      if (!target.noHighlight) {
        const s = sizes[p - 1];
        if (isValidBbox(target.bbox, s.w, s.h)) {
          boxes = [target.bbox];
        } else if (target.quote) {
          const { items, view } = await pageText(p);
          const spans = locateQuote(items, target.quote);
          boxes = (spans ?? []).map((sp) => pdfRectToTopLeft(spanToPdfRect(items[sp.item], sp), view));
        }
      }
      if (cancelled) return;
      setHl({ page: p, boxes, tag: target.tag });
      if (mode === 'scroll') {
        const top = tops[p - 1] ?? 0;
        const y = boxes.length ? top + Math.min(...boxes.map((b) => b[1])) * scale - box.h * 0.35 : top - PAD_Y / 2;
        scrollToY(y);
      }
    })();
    return () => {
      cancelled = true;
    };
    // tops/scale 变化（缩放）不重新跳转；证据或文档变化才跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, targetKey, nonce, docId]);

  // 证据标签号变化（同一页内切换）时只更新文字
  const tagText = target?.tag ?? null;
  useEffect(() => {
    setHl((h) => (h && h.tag !== tagText ? { ...h, tag: tagText } : h));
  }, [tagText]);

  // ---- 滚动时更新当前页
  useEffect(() => {
    if (!scroller || mode !== 'scroll') return;
    const onScroll = () => {
      const probe = scroller.scrollTop + scroller.clientHeight * 0.35;
      let n = 1;
      for (let i = 0; i < tops.length; i++) if (tops[i] <= probe) n = i + 1;
      setPage(n);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scroller, tops, mode]);

  // 缩放后保持当前页在视野里
  const lastScale = useRef(scale);
  useEffect(() => {
    if (mode === 'scroll' && Math.abs(lastScale.current - scale) > 1e-6 && tops[page - 1] !== undefined) {
      const ratio = scale / lastScale.current;
      if (scroller) scroller.scrollTop = scroller.scrollTop * ratio;
    }
    lastScale.current = scale;
  }, [scale, mode, tops, page, scroller]);

  // ---- 页内查找
  useEffect(() => {
    const q = find.query.trim();
    if (!find.open || !q || !doc) {
      setHits([]);
      setFind((f) => (f.total || f.searching ? { ...f, total: 0, active: 0, searching: false } : f));
      return;
    }
    let cancelled = false;
    setFind((f) => ({ ...f, searching: true }));
    const t = setTimeout(async () => {
      const out: Hit[] = [];
      for (let n = 1; n <= sizes.length; n++) {
        const { items, view } = await pageText(n);
        for (const hit of findInItems(items, q)) {
          out.push({ page: n, boxes: hit.map((sp) => pdfRectToTopLeft(spanToPdfRect(items[sp.item], sp), view)) });
        }
        if (cancelled) return;
      }
      setHits(out);
      setFind((f) => ({ ...f, total: out.length, active: 0, searching: false }));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [find.query, find.open, doc, sizes.length, pageText]);

  const showHit = useCallback(
    (i: number) => {
      const h = hits[i];
      if (!h) return;
      setPage(h.page);
      if (mode === 'scroll') {
        const top = tops[h.page - 1] ?? 0;
        scrollToY(top + Math.min(...h.boxes.map((b) => b[1])) * scale - box.h * 0.35);
      }
    },
    [hits, mode, tops, scale, box.h, scrollToY],
  );
  useEffect(() => {
    if (find.total) showHit(find.active);
    // 只在命中集合或当前序号变化时滚动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.active, hits]);

  const onFindStep = (dir: 1 | -1) =>
    setFind((f) => (f.total ? { ...f, active: (f.active + dir + f.total) % f.total } : f));

  const onDownload = async () => {
    setDownloading(true);
    try {
      await downloadRaw(docId, pdfFileName(title));
    } finally {
      setDownloading(false);
    }
  };

  const marksFor = (n: number): PageMarks | undefined => {
    const ev = hl && hl.page === n && hl.boxes.length ? hl.boxes : undefined;
    const fh = hits
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.page === n)
      .map(({ h, i }) => ({ boxes: h.boxes, active: i === find.active }));
    if (!ev && fh.length === 0) return undefined;
    return { evidence: ev, tag: ev ? hl?.tag : null, find: fh };
  };

  // ---- 渲染
  const errorText =
    failed || raw.status === 'error' || loadError
      ? (failedText ?? `预览加载失败：${raw.status === 'error' ? raw.error.message : (loadError ?? '材料解析失败')}`)
      : null;
  const state = errorText ? 'error' : doc ? 'ready' : 'loading';

  return (
    <div
      data-testid={testid}
      data-state={state}
      data-page={page}
      data-scale={scale.toFixed(4)}
      className="flex h-full min-h-0 flex-col"
    >
      <PdfToolbar
        page={page}
        pages={sizes.length || 0}
        zoom={zoom}
        onPage={goPage}
        onZoom={setZoom}
        onDownload={() => void onDownload()}
        downloading={downloading}
        find={find}
        onFind={(patch) => setFind((f) => ({ ...f, ...patch }))}
        onFindStep={onFindStep}
        disabled={state !== 'ready'}
      />
      <div
        ref={setScroller}
        data-testid={`${testid}.scroller`}
        tabIndex={0}
        aria-label={`${title} 预览`}
        className={`mn-focus relative min-h-0 flex-1 bg-[var(--pdf-gutter)] ${
          mode === 'scroll' ? 'overflow-auto' : 'flex flex-col overflow-hidden'
        }`}
      >
        {state === 'error' && (
          <div
            data-testid={`${testid}.error`}
            role="alert"
            className="flex h-full items-center justify-center px-6 text-center text-[13px] text-muted"
          >
            {errorText}
          </div>
        )}
        {state === 'loading' && (
          <div data-testid={`${testid}.loading`} aria-busy="true" className="flex flex-col items-center gap-3 py-4">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="mn-skel w-[calc(100%-64px)] rounded-[2px]"
                style={{ aspectRatio: mode === 'single' ? '16 / 9' : '612 / 792' }}
              />
            ))}
          </div>
        )}
        {state === 'ready' && doc && mode === 'scroll' && (
          <div className="flex flex-col items-center" style={{ padding: `${PAD_Y}px ${PAD_X}px`, gap: GAP }}>
            {sizes.map((s, i) => (
              <div key={i} className="shadow-[var(--pdf-page-shadow)]">
                <PdfPage
                  doc={doc}
                  pageNumber={i + 1}
                  size={s}
                  scale={scale}
                  root={scroller}
                  marks={marksFor(i + 1)}
                  testid={`right.pdf-preview.page:${i + 1}`}
                />
              </div>
            ))}
          </div>
        )}
        {state === 'ready' && doc && mode === 'single' && (
          <>
            <div
              className="flex min-h-0 flex-1 items-center justify-center"
              style={{ padding: `${PAD_Y}px ${PAD_X}px` }}
            >
              <div className="shadow-[var(--pdf-page-shadow)]">
                <PdfPage
                  key={page}
                  doc={doc}
                  pageNumber={page}
                  size={cur}
                  scale={scale}
                  root={null}
                  eager
                  marks={marksFor(page)}
                  testid={`right.slide-preview.page:${page}`}
                />
              </div>
            </div>
            <SlideThumbs doc={doc} sizes={sizes} page={page} onPick={goPage} />
          </>
        )}
      </div>
    </div>
  );
}

/** PPT 预览底部缩略图条（单页模式）；当前页自动滚入视野 */
function SlideThumbs({
  doc,
  sizes,
  page,
  onPick,
}: {
  doc: PDFDocumentProxy;
  sizes: { w: number; h: number }[];
  page: number;
  onPick: (n: number) => void;
}) {
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = strip?.querySelector<HTMLElement>(`[data-thumb="${page}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [page, strip]);
  return (
    <div
      ref={setStrip}
      data-testid="right.slide-preview.thumbs"
      className="flex flex-none gap-2 overflow-x-auto border-t border-line bg-surface px-3 py-2"
      style={{ height: THUMB_H + 8 }}
    >
      {sizes.map((s, i) => {
        const n = i + 1;
        const sc = (THUMB_H - 22) / s.h;
        return (
          <button
            key={n}
            type="button"
            data-thumb={n}
            data-testid={`right.slide-preview.thumb:${n}`}
            aria-label={`第 ${n} 页`}
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onPick(n)}
            className={`mn-focus flex flex-none flex-col items-center gap-0.5 rounded-btn-sm p-0.5 text-[10.5px] ${
              n === page ? 'bg-sel text-ink' : 'text-muted hover:bg-panel'
            }`}
          >
            <span className="block overflow-hidden rounded-[2px] border border-line">
              <PdfPage doc={doc} pageNumber={n} size={s} scale={sc} root={strip} thumbnail />
            </span>
            {n}
          </button>
        );
      })}
    </div>
  );
}
