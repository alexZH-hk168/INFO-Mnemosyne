// 引用标记与偏移换算（F3）。
// 契约 README 第 7 条：sentence_start/end、anchor_start/end、char_range 一律相对“去掉 [[E#]] 后的纯文本”，
// 左闭右开、按 Unicode 码点计数。JS 字符串按 UTF-16 索引，所有换算都经这里，组件里不自己数下标。
import type { Citation } from '../api/types';

/** 正文里的引用标记 `[[E3]]` */
export const CITATION_RE = /\[\[E(\d+)\]\]/g;

/** 原文中的一个引用标记 */
export interface Marker {
  /** `E3` */
  label: string;
  /** 在原文中的 UTF-16 区间 [rawStart, rawEnd) */
  rawStart: number;
  rawEnd: number;
  /** 标记所在位置对应纯文本的码点偏移（标记前面的纯文本码点数） */
  plainCp: number;
}

/** 码点个数（BMP 以外的字符算 1 个） */
export function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    // 高位代理后面跟低位代理：算一个码点
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i += 1;
    }
    n += 1;
  }
  return n;
}

/** 码点偏移 → UTF-16 下标；超出末尾时返回 s.length */
export function cpToUtf16(s: string, cp: number): number {
  if (cp <= 0) return 0;
  let n = 0;
  let i = 0;
  while (i < s.length && n < cp) {
    const c = s.charCodeAt(i);
    const pair =
      c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff;
    i += pair ? 2 : 1;
    n += 1;
  }
  return i;
}

/** UTF-16 下标 → 码点偏移（落在代理对中间时按前一个码点算） */
export function utf16ToCp(s: string, index: number): number {
  return cpLength(s.slice(0, Math.max(0, Math.min(index, s.length))));
}

/** 按码点切片，等价于 Python 的 `s[start:end]` */
export function sliceByCp(s: string, start: number, end?: number): string {
  const a = cpToUtf16(s, start);
  const b = end === undefined ? s.length : cpToUtf16(s, end);
  return s.slice(a, b);
}

/** 去掉全部 `[[E#]]` 标记后的纯文本（复制、偏移计算都基于它） */
export function stripCitations(raw: string): string {
  return raw.replace(CITATION_RE, '');
}

/** 找出全部标记，并算出每个标记在纯文本中的码点位置 */
export function parseCitations(raw: string): { plain: string; markers: Marker[] } {
  const markers: Marker[] = [];
  let plain = '';
  let last = 0;
  let plainCp = 0;
  for (const m of raw.matchAll(CITATION_RE)) {
    const start = m.index ?? 0;
    const chunk = raw.slice(last, start);
    plain += chunk;
    plainCp += cpLength(chunk);
    markers.push({ label: `E${m[1]}`, rawStart: start, rawEnd: start + m[0].length, plainCp });
    last = start + m[0].length;
  }
  plain += raw.slice(last);
  return { plain, markers };
}

/**
 * 纯文本码点偏移 → 原文 UTF-16 下标。
 * 恰好落在标记位置时：`bias='before'` 返回标记之前，`'after'` 返回紧挨着的所有标记之后。
 */
export function plainCpToRaw(raw: string, cp: number, bias: 'before' | 'after' = 'before'): number {
  let remaining = Math.max(0, cp);
  let last = 0;
  for (const m of raw.matchAll(CITATION_RE)) {
    const start = m.index ?? 0;
    const chunk = raw.slice(last, start);
    const len = cpLength(chunk);
    if (remaining < len || (remaining === len && bias === 'before')) {
      return last + cpToUtf16(chunk, remaining);
    }
    remaining -= len;
    last = start + m[0].length;
  }
  const tail = raw.slice(last);
  return last + cpToUtf16(tail, Math.min(remaining, cpLength(tail)));
}

/** 原文 UTF-16 下标 → 纯文本码点偏移（落在标记内部时取标记位置） */
export function rawToPlainCp(raw: string, index: number): number {
  let cp = 0;
  let last = 0;
  for (const m of raw.matchAll(CITATION_RE)) {
    const start = m.index ?? 0;
    if (index <= start) return cp + cpLength(raw.slice(last, index));
    cp += cpLength(raw.slice(last, start));
    if (index < start + m[0].length) return cp;
    last = start + m[0].length;
  }
  return cp + cpLength(raw.slice(last, Math.min(index, raw.length)));
}

/**
 * 流式中正文末尾可能是半个标记（如 `[[E`），返回去掉它之后的文本，避免先闪出字面量。
 * 只处理结尾；中间的不完整写法按普通文字显示。
 */
export function trimPartialMarker(raw: string): string {
  const m = /\[(\[(E\d*\]?)?)?$/.exec(raw);
  return m ? raw.slice(0, m.index) : raw;
}

/** `E3` → `3`；不符合格式时原样返回 */
export function labelNumber(label: string): string {
  const m = /^E(\d+)$/.exec(label);
  return m ? m[1] : label;
}

/**
 * 给每个标记配对引用：先找同 label 且句子区间覆盖标记位置的引用（标记一般在句末标点前，区间左闭右开，
 * 所以 end 也算覆盖），否则取同 label 中尚未用过的第一条。没有引用时为 undefined（待确认）。
 */
export function matchCitations(markers: Marker[], citations: Citation[]): (Citation | undefined)[] {
  const used = new Set<string>();
  return markers.map((mk) => {
    const same = citations.filter((c) => c.label === mk.label);
    const hit =
      same.find((c) => !used.has(c.citation_id) && c.sentence_start <= mk.plainCp && mk.plainCp <= c.sentence_end) ??
      same.find((c) => !used.has(c.citation_id)) ??
      same[0];
    if (hit) used.add(hit.citation_id);
    return hit;
  });
}
