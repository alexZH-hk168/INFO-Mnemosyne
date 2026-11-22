// 对话列表的分页读取（规格 1-项目栏-项目行：首页 3 条；1-项目行-加载更多：每次再取 20 条）。
// query key 仍是 state.md 的 ['conversations', pid]（infinite），只是首页 limit=3。
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ConversationPage } from '../api/endpoints';
import { queryKeys } from '../api/queries';
import type { ID } from '../api/types';

export const FIRST_PAGE = 3;
export const NEXT_PAGE = 20;

export function useProjectConversations(pid: ID, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversations(pid),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<ConversationPage>(`/api/projects/${encodeURIComponent(pid)}/conversations`, {
        query: { cursor: pageParam, limit: pageParam ? NEXT_PAGE : FIRST_PAGE },
        signal,
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}
