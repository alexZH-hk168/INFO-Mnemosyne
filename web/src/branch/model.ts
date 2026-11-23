// F5：分支相关的纯函数（不依赖 React）：分支消息路径、分支叶子、fork 消息是主线第几条回答。
import type { Branch, ConversationTree, ID, Message } from '../api/types';

const byTime = (a: Message, b: Message) => a.created_at.localeCompare(b.created_at);

/** 分支消息：从 fork 消息往下，沿 branch_id 等于本分支的孩子走；同一父消息有多个孩子（重新生成）时取最新的 */
export function branchPath(tree: ConversationTree, bid: ID): Message[] {
  const branch = tree.branches.find((b) => b.id === bid);
  if (!branch) return [];
  const out: Message[] = [];
  const seen = new Set<ID>();
  let cur: ID = branch.fork_message_id;
  for (;;) {
    const kids = tree.messages.filter((m) => m.parent_id === cur && m.branch_id === bid).sort(byTime);
    const next = kids[kids.length - 1];
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    out.push(next);
    cur = next.id;
  }
  return out;
}

/** 分支当前叶子：最后一条分支消息；还没有消息时是 fork 消息（证据可见性按这条路径判断，契约 v0.4 leaf_id） */
export function branchLeaf(tree: ConversationTree, branch: Branch): ID {
  const path = branchPath(tree, branch.id);
  return path.length ? path[path.length - 1].id : branch.fork_message_id;
}

/** fork 消息是主线第几条回答（从根数到 fork 的 assistant 消息个数，含 fork 本身） */
export function forkOrdinal(tree: ConversationTree, branch: Branch): number {
  const byId = new Map(tree.messages.map((m) => [m.id, m]));
  let n = 0;
  let cur = byId.get(branch.fork_message_id);
  const guard = new Set<ID>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.role === 'assistant' && !cur.branch_id) n += 1;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return n;
}

/** “主线 · N 个分支”：不计 archived（与 ConversationSummary.branch_count 口径一致，编排决定 U47） */
export const countedBranches = (branches: Branch[]) => branches.filter((b) => b.status !== 'archived');

/** 分支默认标题：quote 前 12 字（规格 2-划词工具条-开分支追问「交互细则」） */
export const defaultBranchTitle = (quote: string) => Array.from(quote.trim()).slice(0, 12).join('');

/** 状态文字 */
export const STATUS_TEXT: Record<Branch['status'], string> = { open: '进行中', merged: '已合并', archived: '已归档' };
