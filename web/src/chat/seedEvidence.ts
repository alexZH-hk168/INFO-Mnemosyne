import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queries';
import type { Evidence, ID } from '../api/types';

/**
 * INT2（U113 ①）：回答结束时把流式证据池写进 ['evidence', eid] 缓存（已有数据不覆盖，dataUpdatedAt=0 视为过期，
 * 挂载时照常后台重读）。下一轮（包括分支追问）开始时 streaming 被清空，这条回答的胶囊与来源列表改读缓存，
 * 不再先显示“…”占位等 GET /api/evidence 返回。分支回答写带 leaf_id 的键（分支面板的叶子即这条回答）。
 */
export function seedEvidenceCache(qc: QueryClient, evidence: Evidence[], leafId: ID | null) {
  for (const ev of evidence) {
    const key = queryKeys.evidenceAt(ev.id, leafId);
    if (qc.getQueryData(key) === undefined) qc.setQueryData(key, ev, { updatedAt: 0 });
  }
}
