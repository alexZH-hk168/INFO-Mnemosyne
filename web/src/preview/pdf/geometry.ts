// PDF 预览的几何与文本定位（纯函数，便于单测）。
// 坐标约定见 docs/contract/evidence-locator.md：bbox 为 PDF 坐标系 [x0, y0, x1, y1]，原点在页面左上角，单位 pt（PyMuPDF 默认）。
// pdf.js 的 viewport 同样以裁剪框左上角为原点、y 向下，所以 CSS 像素 = pt × 缩放比例。

export type Box = [number, number, number, number];

export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 允许的越界误差（pt）：PyMuPDF 量出的字形框可能略超出页面 */
const TOLERANCE = 1;

/** bbox 是否可用：4 个有限数、x0<x1、y0<y1、落在页面内（规格：缺失或越界时退回高亮文字块） */
export function isValidBbox(b: unknown, pageWidth: number, pageHeight: number): b is Box {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  const [x0, y0, x1, y1] = b as Box;
  if (!(x0 < x1 && y0 < y1)) return false;
  return x0 >= -TOLERANCE && y0 >= -TOLERANCE && x1 <= pageWidth + TOLERANCE && y1 <= pageHeight + TOLERANCE;
}

/** pt → CSS 像素 */
export function boxToCss(b: Box, scale: number): CssRect {
  return { left: b[0] * scale, top: b[1] * scale, width: (b[2] - b[0]) * scale, height: (b[3] - b[1]) * scale };
}

export function unionRects(rects: CssRect[]): CssRect | null {
  if (rects.length === 0) return null;
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let btm = -Infinity;
  for (const x of rects) {
    l = Math.min(l, x.left);
    t = Math.min(t, x.top);
    r = Math.max(r, x.left + x.width);
    btm = Math.max(btm, x.top + x.height);
  }
  return { left: l, top: t, width: r - l, height: btm - t };
}

/** 外挂“证据 N”标签的位置：贴在高亮框右缘之外（落在页边距与页外灰底里，不压正文） */
export function tagPosition(hl: CssRect, gap = 6): { left: number; top: number } {
  return { left: hl.left + hl.width + gap, top: hl.top };
}

// ---------------------------------------------------------------- 文本定位

/** pdf.js TextItem 的最小子集 */
export interface TextItemLike {
  str: string;
  /** [a, b, c, d, e, f]：e/f 是基线起点（PDF 用户空间，y 向上） */
  transform: number[];
  width: number;
  height: number;
}

/** 某个文本项里的一段：[start, end) 为该项 str 的 UTF-16 下标 */
export interface ItemSpan {
  item: number;
  start: number;
  end: number;
}

type Norm = 'find' | 'quote';

/** 归一化：查找时忽略大小写与空白；按证据原文定位时只留字母和数字（避开 · Σ 上下标等排版差异） */
function keep(ch: string, mode: Norm): string {
  if (mode === 'find') return /\s/.test(ch) ? '' : ch.toLowerCase();
  return /[\p{L}\p{N}]/u.test(ch) ? ch.toLowerCase() : '';
}

interface Indexed {
  text: string;
  /** text 的每个 UTF-16 位置对应 (item, offset) */
  map: { item: number; offset: number }[];
}

function indexItems(items: { str: string }[], mode: Norm): Indexed {
  let text = '';
  const map: Indexed['map'] = [];
  items.forEach((it, i) => {
    for (let o = 0; o < it.str.length; o++) {
      const k = keep(it.str[o], mode);
      for (let j = 0; j < k.length; j++) {
        text += k[j];
        map.push({ item: i, offset: o });
      }
    }
  });
  return { text, map };
}

function normalize(s: string, mode: Norm): string {
  let out = '';
  for (const ch of s) out += keep(ch, mode);
  return out;
}

/** 文本区间 [a, b)（归一化坐标）→ 每个文本项里的一段 */
function toSpans(idx: Indexed, a: number, b: number): ItemSpan[] {
  const spans: ItemSpan[] = [];
  for (let p = a; p < b; p++) {
    const { item, offset } = idx.map[p];
    const last = spans[spans.length - 1];
    if (last && last.item === item) last.end = Math.max(last.end, offset + 1);
    else spans.push({ item, start: offset, end: offset + 1 });
  }
  return spans;
}

/** 页内查找：返回每个命中（忽略大小写与空白），每个命中可能跨多个文本项 */
export function findInItems(items: { str: string }[], query: string): ItemSpan[][] {
  const q = normalize(query, 'find');
  if (!q) return [];
  const idx = indexItems(items, 'find');
  const hits: ItemSpan[][] = [];
  let from = 0;
  for (;;) {
    const at = idx.text.indexOf(q, from);
    if (at < 0) break;
    hits.push(toSpans(idx, at, at + q.length));
    from = at + q.length;
  }
  return hits;
}

/**
 * 按证据原文找它在页面文本里的位置（bbox 缺失或越界时的退路）：先找原文开头一段，再在其后找结尾一段，
 * 两者之间的文本项即“所在文字块”。找不到开头时返回 null。
 */
export function locateQuote(items: { str: string }[], quote: string, head = 24, tail = 16): ItemSpan[] | null {
  const q = normalize(quote, 'quote');
  if (!q) return null;
  const idx = indexItems(items, 'quote');
  const h = q.slice(0, Math.min(head, q.length));
  const start = idx.text.indexOf(h);
  if (start < 0) return null;
  let end = start + h.length;
  if (q.length > h.length) {
    const t = q.slice(-Math.min(tail, q.length - h.length));
    const at = idx.text.indexOf(t, end - 1);
    if (at >= 0 && at - start <= q.length * 2) end = at + t.length;
  }
  return toSpans(idx, start, end);
}

/**
 * 文本项的一段 → PDF 用户空间矩形 [x0, y0, x1, y1]（y 向上），宽度按字符比例截取。
 * 字形框按基线下 0.25 倍字号、上 0.85 倍字号估算。
 */
export function spanToPdfRect(item: TextItemLike, span: ItemSpan): Box {
  const x = item.transform[4];
  const y = item.transform[5];
  const len = Math.max(1, item.str.length);
  const h = item.height || Math.hypot(item.transform[2], item.transform[3]) || 10;
  const x0 = x + (item.width * span.start) / len;
  const x1 = x + (item.width * span.end) / len;
  return [x0, y - h * 0.25, x1, y + h * 0.85];
}

/**
 * PDF 用户空间矩形（y 向上）→ 契约坐标（原点左上、y 向下、pt）。view 是 pdf.js 的 page.view（裁剪框 [x0, y0, x1, y1]）。
 * v1 只处理未旋转页面。
 */
export function pdfRectToTopLeft(r: Box, view: number[]): Box {
  const [vx0, , , vy1] = view;
  return [r[0] - vx0, vy1 - r[3], r[2] - vx0, vy1 - r[1]];
}
