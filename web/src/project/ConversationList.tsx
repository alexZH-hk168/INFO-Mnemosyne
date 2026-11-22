// 规格：1-项目行-加载更多（sidebar.load-more）＋ 项目展开后的对话列表
import type { ID } from '../api/types';
import { Spinner } from '../icons/Icons';
import { useChat } from '../store/chat';
import ConversationRow from './ConversationRow';
import { useProjectConversations } from './useProjectConversations';

export default function ConversationList({ pid }: { pid: ID }) {
  const q = useProjectConversations(pid, true);
  const conversationId = useChat((s) => s.conversationId);
  const rows = q.data?.pages.flatMap((p) => p.conversations) ?? [];

  return (
    <div data-testid={`sidebar.conversation-list:${pid}`} className="mb-1.5 ml-[15px] mt-0.5 border-l border-line pl-2">
      {q.isPending && (
        <div data-testid="sidebar.conversation-list.loading" aria-busy="true" className="space-y-2 py-1.5 pr-2">
          <div className="mn-skel h-3.5 w-[85%]" />
          <div className="mn-skel h-3.5 w-[65%]" />
        </div>
      )}
      {q.isError && (
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="mn-focus px-2 py-1 text-[12px] text-muted hover:text-ink"
        >
          加载失败 · 重试
        </button>
      )}
      {rows.map((c) => (
        <ConversationRow key={c.id} conversation={c} active={c.id === conversationId} />
      ))}
      {q.hasNextPage && (
        <button
          type="button"
          data-testid={`sidebar.load-more:${pid}`}
          aria-busy={q.isFetchingNextPage || undefined}
          disabled={q.isFetchingNextPage}
          onClick={() => {
            // 正在取时再点不重复请求（cancelRefetch=false：进行中的请求不取消、新调用被忽略）
            if (!q.isFetchingNextPage) void q.fetchNextPage({ cancelRefetch: false });
          }}
          className="mn-focus flex min-h-[28px] w-full items-center rounded-btn-sm px-2 py-[5px] text-left text-[12px] text-faint hover:text-ink-2 disabled:cursor-default"
        >
          {q.isFetchingNextPage ? <Spinner size={13} /> : '加载更多'}
        </button>
      )}
    </div>
  );
}
