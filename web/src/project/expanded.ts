// 项目栏本地状态：展开的项目 id（规格 1-项目栏-项目行「本地 state expandedIds（持久化到 mn.sidebar.v1）」）。
import { useCallback, useState } from 'react';
import type { ID } from '../api/types';

export const SIDEBAR_KEY = 'mn.sidebar.v1';

function load(): ID[] | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { expandedIds?: unknown };
    return Array.isArray(v.expandedIds) ? v.expandedIds.filter((x): x is ID => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

function save(ids: ID[]): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ expandedIds: ids }));
  } catch {
    // 隐私模式等写不进去时忽略
  }
}

export function useExpandedIds() {
  const [ids, setIds] = useState<ID[]>(() => load() ?? []);
  const update = useCallback((fn: (prev: ID[]) => ID[]) => {
    setIds((prev) => {
      const next = fn(prev);
      if (next !== prev) save(next);
      return next;
    });
  }, []);
  const expand = useCallback((id: ID) => update((p) => (p.includes(id) ? p : [...p, id])), [update]);
  const collapse = useCallback((id: ID) => update((p) => (p.includes(id) ? p.filter((x) => x !== id) : p)), [update]);
  return { expandedIds: ids, expand, collapse };
}
