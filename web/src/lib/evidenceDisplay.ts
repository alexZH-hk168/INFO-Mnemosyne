// 证据在对话栏里的展示规则：胶囊文字、配色、悬停浮层里的位置说明。
// 来源：规格 1-助手回答-证据胶囊「交互细则」、docs/contract/evidence-locator.md「胶囊配色」。
import type { Evidence, SourceType } from '../api/types';
import { cpLength } from './citations';

export type ChipTone = 'material' | 'web' | 'message';

/** 琥珀＝材料、蓝＝网页/插件、灰＝历史对话 */
export function chipTone(t: SourceType): ChipTone {
  if (t === 'material') return 'material';
  if (t === 'message') return 'message';
  return 'web';
}

/** tailwind 类：底色与文字色（token 见 tokens.css 的 --evi-*） */
export const TONE_CLASS: Record<ChipTone, string> = {
  material: 'bg-evi-bg text-evi-ink',
  web: 'bg-evi-web-bg text-evi-web-ink',
  message: 'bg-evi-msg-bg text-evi-msg-ink',
};

type Loc = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;

/** 截前 n 个码点 */
function headCp(s: string, n: number): string {
  return Array.from(s).slice(0, n).join('');
}

/**
 * 胶囊里的位置简写：PDF `p.4`、PPT `p.18`、代码 `L7`、网页“网页”、历史对话用对话标题前 4 字、无 URL 插件“插件”。
 * 规格里的“脚注 4”需要 locator 标明脚注，契约 v0.2 的 PDF locator 没有该字段，先按页码显示（编排决定 U34：维持 p.N，不改契约；UI-05 的“脚注 4”记为概念图与实现差异）。
 */
export function chipPosition(ev: Pick<Evidence, 'source_type' | 'locator' | 'title'>): string {
  const loc = ev.locator as Loc;
  switch (ev.source_type) {
    case 'web':
      return '网页';
    case 'message':
      return headCp(ev.title, 4);
    case 'plugin':
      return '插件';
    default: {
      const page = num(loc.page);
      if (page !== null) return `p.${page}`;
      const slide = num(loc.slide);
      if (slide !== null) return `p.${slide}`;
      const lines = pair(loc.lines);
      if (lines) return `L${lines[0]}`;
      return '';
    }
  }
}

/** 悬停浮层里的完整位置说明 */
export function longPosition(ev: Pick<Evidence, 'source_type' | 'locator' | 'title'>): string {
  const loc = ev.locator as Loc;
  switch (ev.source_type) {
    case 'web':
      return '网页快照';
    case 'message':
      return '历史对话';
    case 'plugin':
      return typeof loc.tool_name === 'string' ? `插件 · ${loc.tool_name}` : '插件结果';
    default: {
      const page = num(loc.page);
      if (page !== null) return `第 ${page} 页`;
      const slide = num(loc.slide);
      if (slide !== null) return `第 ${slide} 页幻灯片`;
      const lines = pair(loc.lines);
      const cell = num(loc.cell);
      if (lines) {
        const range = lines[0] === lines[1] ? `第 ${lines[0]} 行` : `第 ${lines[0]}–${lines[1]} 行`;
        return cell !== null ? `单元格 ${cell + 1} · ${range}` : range;
      }
      return '';
    }
  }
}

/** 胶囊文字“1 · p.4” */
export function chipText(number: string, ev?: Pick<Evidence, 'source_type' | 'locator' | 'title'>): string {
  const pos = ev ? chipPosition(ev) : '';
  return pos ? `${number} · ${pos}` : number;
}

/** 来源卡用的类型：pdf / pptx / code / web / message / plugin（决定小图标） */
export type SourceKind = 'pdf' | 'pptx' | 'code' | 'web' | 'message' | 'plugin';
export function sourceKind(ev: Pick<Evidence, 'source_type' | 'locator'>): SourceKind {
  const loc = ev.locator as Loc;
  if (ev.source_type === 'web') return 'web';
  if (ev.source_type === 'message') return 'message';
  if (ev.source_type === 'plugin') return 'plugin';
  if ('page' in loc) return 'pdf';
  if ('slide' in loc) return 'pptx';
  return 'code';
}

/** 超过 n 个码点时截断加省略号（标题等） */
export function ellipsis(s: string, n: number): string {
  return cpLength(s) > n ? `${headCp(s, n)}…` : s;
}
