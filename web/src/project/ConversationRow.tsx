// 规格：1-项目行-对话行（sidebar.conversation-row）
// 气泡图标、标题（省略号）、右侧分支数（branch_count > 0）或相对时间。行内不放“…”菜单（v1 不做重命名/删除）。
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import type { ConversationSummary, ConversationTree } from '../api/types';
import { BranchIcon, MessageIcon } from '../icons/Icons';
import { tabFor } from '../lib/documents';
import { goConversation } from '../lib/nav';
import { relativeDay } from '../lib/time';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';

/** 标题未生成时的占位（规格说显示首条用户消息前 20 字，但列表接口不含消息内容，见汇报） */
export const UNTITLED = '新对话';

interface Props {
  conversation: ConversationSummary;
  active: boolean;
}

export default function ConversationRow({ conversation: c, active }: Props) {
  const qc = useQueryClient();

  const openLatestBranch = async () => {
    goConversation(c.id);
    try {
      const tree = await qc.fetchQuery({
        queryKey: queryKeys.tree(c.id),
        queryFn: ({ signal }) =>
          api.get<ConversationTree>(`/api/conversations/${encodeURIComponent(c.id)}/tree`, { signal }),
      });
      const latest = tree.branches
        .filter((b) => b.status === 'open')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (latest) useLayout.getState().openTab(tabFor('branch', latest.id, latest.title));
    } catch (e) {
      useUI.getState().pushToast({ kind: 'error', text: `读取分支失败：${(e as Error).message}` });
    }
  };

  const title = c.title.trim() || UNTITLED;
  return (
    <div
      className={`group flex items-center rounded-btn-sm text-[13px] ${
        active ? 'bg-sel text-ink' : 'text-ink-2 hover:bg-sel'
      }`}
    >
      <button
        type="button"
        data-testid={`sidebar.conversation-row:${c.id}`}
        aria-current={active ? 'page' : undefined}
        title={title}
        onClick={() => goConversation(c.id)}
        className="mn-focus flex min-w-0 flex-1 items-center gap-2 rounded-btn-sm py-[5px] pl-2 pr-1 text-left"
      >
        <MessageIcon size={14} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {c.branch_count === 0 && (
          <span className="flex-none whitespace-nowrap pr-1 text-[11.5px] text-faint">{relativeDay(c.updated_at)}</span>
        )}
      </button>
      {c.branch_count > 0 && (
        <button
          type="button"
          data-testid={`sidebar.conversation-row.branches:${c.id}`}
          aria-label={`${c.branch_count} 个分支，打开最近的分支`}
          title="打开最近的分支"
          onClick={() => void openLatestBranch()}
          className="mn-focus mr-1 inline-flex flex-none items-center gap-[3px] rounded-btn-sm px-1 py-0.5 text-[11px] text-muted hover:text-ink"
        >
          <BranchIcon size={14} />
          {c.branch_count}
        </button>
      )}
    </div>
  );
}
