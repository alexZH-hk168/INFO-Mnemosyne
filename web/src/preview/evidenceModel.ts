// 证据栏与预览共用的规则（纯函数）：同一回答的证据顺序、证据序号、“被主线第 N 条回答引用”。
import type { Branch, Citation, ID, Message } from '../api/types';
import { labelNumber } from '../lib/citations';

/** 同一回答可左右切换的证据：与来源列表一致，只要 supported / partial，同一证据只算一次，按序号排 */
export function answerEvidenceIds(citations: Citation[]): ID[] {
  const seen = new Set<ID>();
  return citations
    .filter((c) => c.verdict === 'supported' || c.verdict === 'partial')
    .filter((c) => (seen.has(c.eid) ? false : (seen.add(c.eid), true)))
    .sort((a, b) => Number(labelNumber(a.label)) - Number(labelNumber(b.label)))
    .map((c) => c.eid);
}

/** 证据在这条回答里的序号（E1 → "1"）；找不到时为 null */
export function evidenceNumber(citations: Citation[], eid: ID): string | null {
  const c = citations.find((x) => x.eid === eid);
  return c ? labelNumber(c.label) : null;
}

/** 从某条消息沿 parent 往上数助手回答（含自身），只数同一条线上的（主线：branch_id 为空；分支：同一 branch_id） */
function ordinalOf(messages: Message[], from: ID | undefined, branchId: ID | undefined, includeSelf: boolean): number {
  const byId = new Map(messages.map((m) => [m.id, m]));
  let n = 0;
  let cur = from ? byId.get(from) : undefined;
  let first = true;
  while (cur) {
    if (cur.role === 'assistant' && (cur.branch_id ?? undefined) === branchId && (includeSelf || !first)) n += 1;
    first = false;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return n;
}

/**
 * “主线第 1 条回答” / “分支「标题」第 2 条回答”。
 * 回答还没进对话树（刚生成完）时，用它的父消息推算：ordinal = 父链上的助手回答数 + 1。
 */
export function describeAnswer(
  messages: Message[],
  branches: Branch[],
  messageId: ID,
  pending?: { parent_id?: ID; branch_id?: ID },
): string | null {
  const msg = messages.find((m) => m.id === messageId);
  let branchId: ID | undefined;
  let n: number;
  if (msg) {
    branchId = msg.branch_id ?? undefined;
    n = ordinalOf(messages, msg.id, branchId, true);
  } else if (pending) {
    branchId = pending.branch_id;
    n = ordinalOf(messages, pending.parent_id, branchId, true) + 1;
  } else {
    return null;
  }
  if (n < 1) return null;
  if (!branchId) return `主线第 ${n} 条回答`;
  const b = branches.find((x) => x.id === branchId);
  return b ? `分支「${b.title}」第 ${n} 条回答` : `分支第 ${n} 条回答`;
}
