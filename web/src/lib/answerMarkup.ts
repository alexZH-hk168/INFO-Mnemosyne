// 回答正文的标记处理：把 `[[E#]]` 换成胶囊占位、在 partial 引用句末插入“推断”占位，再交给 Markdown 渲染。
// 偏移全部按契约（去掉标记后的纯文本、码点、左闭右开）经 lib/citations 换算。
import type { Citation } from '../api/types';
import { matchCitations, parseCitations, plainCpToRaw } from './citations';

/** 占位字符（Unicode 私用区），不会出现在正常正文里 */
export const SENTINEL_OPEN = '\uE000';
export const SENTINEL_CLOSE = '\uE001';
export const SENTINEL_RE = /\uE000([ci])(\d+)\uE001/g;

export interface ChipSlot {
  label: string;
  citation?: Citation;
}
export interface InferenceSlot {
  citation: Citation;
}

export interface AnswerMarkup {
  /** 带占位字符的 Markdown 源 */
  source: string;
  chips: ChipSlot[];
  inferences: InferenceSlot[];
}

/**
 * @param raw 原文（含 `[[E#]]`）
 * @param citations 已收到的引用
 */
export function buildAnswerMarkup(raw: string, citations: Citation[]): AnswerMarkup {
  const { markers } = parseCitations(raw);
  const pairs = matchCitations(markers, citations);
  type Op = { at: number; end: number; text: string; order: number };
  const ops: Op[] = [];
  const chips: ChipSlot[] = markers.map((m, i) => {
    const slot: ChipSlot = { label: m.label };
    if (pairs[i]) slot.citation = pairs[i];
    ops.push({ at: m.rawStart, end: m.rawEnd, text: `${SENTINEL_OPEN}c${i}${SENTINEL_CLOSE}`, order: 0 });
    return slot;
  });
  // partial 引用：句末（标点之后、紧挨着的胶囊之后）加“推断”；同一句只加一次
  const inferences: InferenceSlot[] = [];
  const seenEnds = new Set<number>();
  for (const c of citations) {
    if (c.verdict !== 'partial' || seenEnds.has(c.sentence_end)) continue;
    seenEnds.add(c.sentence_end);
    const at = plainCpToRaw(raw, c.sentence_end, 'after');
    ops.push({ at, end: at, text: `${SENTINEL_OPEN}i${inferences.length}${SENTINEL_CLOSE}`, order: 1 });
    inferences.push({ citation: c });
  }
  ops.sort((a, b) => a.at - b.at || a.order - b.order);
  let out = '';
  let last = 0;
  for (const op of ops) {
    out += raw.slice(last, op.at) + op.text;
    last = Math.max(last, op.end);
  }
  out += raw.slice(last);
  return { source: out, chips, inferences };
}

// ---------------------------------------------------------------- rehype 插件
// 只用到 hast 的最小结构，避免直接依赖 @types/hast
interface HNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
}

function splitText(value: string): HNode[] | null {
  if (!value.includes(SENTINEL_OPEN)) return null;
  const out: HNode[] = [];
  let last = 0;
  for (const m of value.matchAll(SENTINEL_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ type: 'text', value: value.slice(last, i) });
    out.push({
      type: 'element',
      tagName: 'span',
      properties: m[1] === 'c' ? { dataMnChip: m[2] } : { dataMnInf: m[2] },
      children: [],
    });
    last = i + m[0].length;
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function walk(node: HNode) {
  if (!node.children) return;
  const next: HNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const parts = splitText(child.value);
      if (parts) {
        next.push(...parts);
        continue;
      }
    }
    walk(child);
    next.push(child);
  }
  node.children = next;
}

/** 把文本里的占位字符换成 `<span data-mn-chip>` / `<span data-mn-inf>`，由 Markdown 组件映射成胶囊与“推断” */
export function rehypeAnswerSlots() {
  return (tree: unknown) => {
    walk(tree as HNode);
  };
}
