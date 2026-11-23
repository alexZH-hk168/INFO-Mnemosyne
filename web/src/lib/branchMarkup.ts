// F5：主线回答里的分支标记（规格 1-助手回答-分支标记）。
// 已开过分支的原句加虚线下划线、句末小标“⑂ 分支”。做法与胶囊相同：先在 Markdown 源里插占位字符，
// 渲染成 hast 后由 rehypeBranchMarks 把起止占位之间的文字包进 `<span data-mn-mark>`，终点放 `<span data-mn-badge>`，
// 再由 AnswerBody 映射到 BranchMark 组件。锚点坐标与契约一致（去掉 [[E#]] 后的纯文本、码点、左闭右开）。
import type { Branch, ID } from '../api/types';
import { cpLength, stripCitations } from './citations';

/** 同一句（区间相交）的分支合成一组：一条下划线、一个小标；多个分支时小标显示“⑂ N”，点击弹出选择 */
export interface MarkGroup {
  /** 组序号（本条回答内） */
  index: number;
  start: number;
  end: number;
  branches: Branch[];
}

/** 本条回答上要画的分支标记；archived 不画（与“主线 · N 个分支”不计 archived 一致） */
export function markGroupsFor(messageId: ID, content: string, branches: Branch[]): MarkGroup[] {
  const len = cpLength(stripCitations(content));
  const list = branches
    .filter((b) => b.fork_message_id === messageId && b.status !== 'archived')
    .map((b) => ({ b, start: Math.max(0, b.anchor_start), end: Math.min(len, b.anchor_end) }))
    .filter((x) => x.end > x.start)
    .sort((x, y) => x.start - y.start || x.end - y.end || x.b.created_at.localeCompare(y.b.created_at));
  const groups: MarkGroup[] = [];
  for (const x of list) {
    const g = groups[groups.length - 1];
    if (g && x.start < g.end) {
      g.end = Math.max(g.end, x.end);
      g.branches.push(x.b);
    } else groups.push({ index: groups.length, start: x.start, end: x.end, branches: [x.b] });
  }
  return groups;
}

// ---------------------------------------------------------------- rehype 插件
export const MARK_RE = /\uE000([se])(\d+)\uE001/g;

interface HNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
}

interface State {
  open: string | null;
}

function splitMarks(value: string, st: State): HNode[] {
  const out: HNode[] = [];
  const push = (text: string) => {
    if (!text) return;
    if (st.open === null) out.push({ type: 'text', value: text });
    else
      out.push({
        type: 'element',
        tagName: 'span',
        properties: { dataMnMark: st.open },
        children: [{ type: 'text', value: text }],
      });
  };
  let last = 0;
  for (const m of value.matchAll(MARK_RE)) {
    const i = m.index ?? 0;
    push(value.slice(last, i));
    if (m[1] === 's') st.open = m[2];
    else {
      out.push({ type: 'element', tagName: 'span', properties: { dataMnBadge: m[2] }, children: [] });
      st.open = null;
    }
    last = i + m[0].length;
  }
  push(value.slice(last));
  return out;
}

function walk(node: HNode, st: State) {
  if (!node.children) return;
  const next: HNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      if (child.value.includes('\uE000') || st.open !== null) next.push(...splitMarks(child.value, st));
      else next.push(child);
      continue;
    }
    walk(child, st);
    next.push(child);
  }
  node.children = next;
}

/** 把起止占位之间的文字包成 `<span data-mn-mark=组号>`，终点放 `<span data-mn-badge=组号>` */
export function rehypeBranchMarks() {
  return (tree: unknown) => {
    walk(tree as HNode, { open: null });
  };
}
