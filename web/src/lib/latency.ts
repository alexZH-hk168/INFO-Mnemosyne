// 步骤行的整轮耗时（编排决定 U35：秒数改用整轮耗时，不再用各步 duration_ms 之和）。
// 来源按优先级：
//   1. 本次会话里流式收到的回答：`message.end.latency_ms`（契约 sse-events.md 的整轮耗时字段）；
//      以 `error` 结束、没有 message.end 时，用收到 error 与收到 message.start 的本地时刻之差（store/chat.ts 的 streaming.latency_ms）。
//   2. 历史消息：契约 v0.2 的 Message 没有耗时字段，用“回答的 created_at − 其用户消息的 created_at”推算
//      （fixture msg_tf_a1：06:20:09 − 06:20:00 = 9 s，与同一回答事件流里的 latency_ms 9120 一致）。
//      只对该用户消息下最早的那个回答成立：重新生成的兄弟回答，created_at 是重新生成的时刻，与用户提问相隔可能很久，
//      这时不推算、不显示秒数。
import type { ID, Message } from '../api/types';

/** 历史消息的整轮耗时（毫秒）；推不出时为 undefined */
export function historyLatencyMs(m: Message, byId: Map<ID, Message>, siblings: ID[]): number | undefined {
  if (m.role !== 'assistant' || !m.parent_id) return undefined;
  const parent = byId.get(m.parent_id);
  if (!parent || parent.role !== 'user') return undefined;
  // 只有最早的回答（非重新生成）才用时间差
  if (siblings.length > 0 && siblings[0] !== m.id) return undefined;
  const end = Date.parse(m.created_at);
  const start = Date.parse(parent.created_at);
  if (!Number.isFinite(end) || !Number.isFinite(start) || end < start) return undefined;
  return end - start;
}
