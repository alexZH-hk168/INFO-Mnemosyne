// F5：把助手回答正文里的 DOM 选区换算成契约坐标（规格 2-划词-划词工具条「交互细则」）。
// 契约（rest-api.md「分支」、README 第 7 条）：anchor.start/end 相对 fork 消息 content 去掉 [[E#]] 后的纯文本，
// 左闭右开、按 Unicode 码点计数。渲染后的 DOM 文本与纯文本不完全相同：Markdown 语法字符被吃掉，
// 证据胶囊（“1 · p.4”）、“推断”小标、分支小标是额外插进来的界面文字。做法：
//   1. 按文档顺序取正文里的文本节点，跳过胶囊、推断、分支小标与 KaTeX 的 MathML 副本；
//   2. 把每个 DOM 字符按顺序对齐到纯文本（DOM 字符是纯文本的子序列：只会少语法字符，不会多）；
//   3. 选区两端落到对齐结果上，得到纯文本 UTF-16 区间，再换成码点。
import { sliceByCp, stripCitations, utf16ToCp } from './citations';

/** 不计入选区与复制内容的界面元素 */
export const SKIP_SELECTOR = [
  'button[data-testid^="chat.evidence-chip"]',
  '[data-testid^="chat.inference-mark"]',
  '[data-mn-skip]',
  '.katex-mathml',
].join(',');

/** 非空白字符最多向前找多远（Markdown 链接地址等被吃掉的语法可能较长） */
const MAX_JUMP = 400;
/** 空白字符只在很近处找：块之间的换行在纯文本里可能对不上 */
const WS_JUMP = 4;

interface Piece {
  node: Text;
  /** node 每个 UTF-16 下标对应的纯文本 UTF-16 下标（对不上为 -1） */
  map: number[];
}

/** 正文里参与对齐的文本节点 */
function textNodes(root: Element): Text[] {
  const out: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const skip = n.parentElement?.closest(SKIP_SELECTOR);
      return skip && root.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** 把 DOM 文本逐字对齐到纯文本 */
export function alignDom(root: Element, plain: string): Piece[] {
  const pieces: Piece[] = [];
  let p = 0;
  for (const node of textNodes(root)) {
    const s = node.data;
    const map: number[] = new Array<number>(s.length).fill(-1);
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      const ws = /\s/.test(c);
      const limit = Math.min(plain.length, p + (ws ? WS_JUMP : MAX_JUMP));
      let hit = -1;
      for (let j = p; j < limit; j += 1) {
        if (plain[j] === c || (ws && /\s/.test(plain[j]))) {
          hit = j;
          break;
        }
      }
      if (hit >= 0) {
        map[i] = hit;
        p = hit + 1;
      }
    }
    pieces.push({ node, map });
  }
  return pieces;
}

/** 某个 DOM 边界点（container, offset）在对齐表里的位置：返回 [片段序号, 片段内下标]，表示“边界在这个字符之前” */
function boundaryIndex(pieces: Piece[], root: Element, container: Node, offset: number): [number, number] {
  const idx = pieces.findIndex((x) => x.node === container);
  if (idx >= 0) return [idx, offset];
  // 边界落在元素上（如选到块末尾）：找边界之后的第一个文本节点
  const doc = root.ownerDocument;
  const probe = doc.createRange();
  probe.setStart(container, offset);
  for (let i = 0; i < pieces.length; i += 1) {
    const r = doc.createRange();
    r.selectNodeContents(pieces[i].node);
    // 文本节点的起点在边界之后（含相等）：边界就在这个节点开头
    if (probe.compareBoundaryPoints(Range.START_TO_START, r) <= 0) return [i, 0];
  }
  return [pieces.length, 0];
}

/** 从边界往后找第一个对得上的字符（选区起点） */
function firstMappedFrom(pieces: Piece[], at: [number, number], stop: [number, number]): number {
  for (let i = at[0]; i < pieces.length; i += 1) {
    const from = i === at[0] ? at[1] : 0;
    const to = i === stop[0] ? stop[1] : pieces[i].map.length;
    for (let k = from; k < to; k += 1) if (pieces[i].map[k] >= 0) return pieces[i].map[k];
    if (i === stop[0]) break;
  }
  return -1;
}

/** 从边界往前找最后一个对得上的字符（选区终点，返回其后一位） */
function lastMappedBefore(pieces: Piece[], at: [number, number], start: [number, number]): number {
  for (let i = Math.min(at[0], pieces.length - 1); i >= 0; i -= 1) {
    const to = i === at[0] ? at[1] : pieces[i].map.length;
    const from = i === start[0] ? start[1] : 0;
    for (let k = to - 1; k >= from; k -= 1) if (pieces[i].map[k] >= 0) return pieces[i].map[k] + 1;
    if (i === start[0]) break;
  }
  return -1;
}

export interface PlainRange {
  /** 码点偏移，左闭右开 */
  start: number;
  end: number;
  /** 纯文本里这一段（不含胶囊文字） */
  quote: string;
}

/**
 * DOM Range → 纯文本码点区间。
 * @param root 回答正文元素（AnswerBody 的根，带 data-message-id）
 * @param content 消息原文（含 [[E#]]）
 * @returns 选区里没有可对齐的正文时为 null
 */
export function rangeToPlain(root: Element, content: string, range: Range): PlainRange | null {
  const plain = stripCitations(content);
  const pieces = alignDom(root, plain);
  if (pieces.length === 0) return null;
  const a = boundaryIndex(pieces, root, range.startContainer, range.startOffset);
  const b = boundaryIndex(pieces, root, range.endContainer, range.endOffset);
  const s16 = firstMappedFrom(pieces, a, b);
  const e16 = lastMappedBefore(pieces, b, a);
  if (s16 < 0 || e16 < 0 || e16 <= s16) return null;
  // 去掉两端空白（双击、拖选常带上）
  let s = s16;
  let e = e16;
  while (s < e && /\s/.test(plain[s])) s += 1;
  while (e > s && /\s/.test(plain[e - 1])) e -= 1;
  if (e <= s) return null;
  const start = utf16ToCp(plain, s);
  const end = utf16ToCp(plain, e);
  return { start, end, quote: sliceByCp(plain, start, end) };
}

/** 纯文本码点区间 → DOM Range（测试与“回到原处”定位用）；对不上时为 null */
export function plainToRange(root: Element, content: string, start: number, end: number): Range | null {
  const plain = stripCitations(content);
  const pieces = alignDom(root, plain);
  const s16 = sliceByCp(plain, 0, start).length;
  const e16 = sliceByCp(plain, 0, end).length;
  let first: { node: Text; at: number } | null = null;
  let last: { node: Text; at: number } | null = null;
  for (const pc of pieces) {
    for (let k = 0; k < pc.map.length; k += 1) {
      const m = pc.map[k];
      if (m < s16 || m >= e16) continue;
      if (!first) first = { node: pc.node, at: k };
      last = { node: pc.node, at: k + 1 };
    }
  }
  if (!first || !last) return null;
  const r = root.ownerDocument.createRange();
  r.setStart(first.node, first.at);
  r.setEnd(last.node, last.at);
  return r;
}

/** 选区长度（码点）；工具条要求 ≥ 2 */
export const MIN_SELECTION = 2;
export const selectionLength = (r: PlainRange) => r.end - r.start;
